// ============================================================
// POST /api/stripe-webhook
// Stripe calls this when a payment succeeds. This is the SOURCE OF TRUTH for
// "the customer actually paid" — never mark an order paid from the browser.
// On success: mark the order paid, capture the customer email + receipt, and
// decrement stock. Fulfillment is done by hand in the Printful dashboard, so
// the order is left at status 'paid' for the owner to process.
//
// Set the webhook in Stripe → Developers → Webhooks → add endpoint:
//   https://YOUR-APP.vercel.app/api/stripe-webhook   event: payment_intent.succeeded
// ============================================================
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Vercel: disable body parsing so we can verify the raw signature
export const config = { api: { bodyParser: false } };

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => (data += chunk));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

// The customer's email isn't known when the PaymentIntent is created (Stripe's
// Payment Element mounts before they type it), so the order row starts with a
// placeholder. By the time the payment succeeds the real email lives on the
// PaymentIntent: set as receipt_email on the card path, or on the wallet's
// charge for Apple/Google Pay. Pull whichever is present.
async function resolveCustomerEmail(pi) {
  if (pi.receipt_email) return pi.receipt_email;
  if (pi.metadata?.email) return pi.metadata.email;
  // Express Checkout (wallet) payments never set receipt_email in the browser;
  // the email rides on the charge's billing details instead.
  const chargeId = typeof pi.latest_charge === 'string' ? pi.latest_charge : pi.latest_charge?.id;
  if (chargeId) {
    try {
      const charge = await stripe.charges.retrieve(chargeId);
      if (charge.billing_details?.email) return charge.billing_details.email;
    } catch (err) {
      console.error('Could not read charge email:', err.message);
    }
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  let event;
  try {
    const raw = await readRawBody(req);
    event = stripe.webhooks.constructEvent(raw, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'payment_intent.succeeded') {
    const pi = event.data.object;
    const orderId = pi.metadata?.order_id;
    try {
      // Atomically claim the order: flip pending -> paid only if it's still
      // pending, backfilling the real customer email in the same write. Stripe
      // retries on any non-2xx and can deliver duplicate events; gating on
      // `.eq('status', 'pending')` means only the first delivery matches a row,
      // so stock is never double-decremented on a retry.
      const customerEmail = await resolveCustomerEmail(pi);
      const { data: claimed } = await supabase.from('orders').update({
        status: 'paid',
        ...(customerEmail ? { email: customerEmail } : {})
      }).eq('id', orderId).eq('status', 'pending').select();

      if (claimed && claimed.length > 0) {
        const order = claimed[0];

        // Guarantee a receipt. Cards already carry receipt_email; wallet
        // payments don't, so set it on the succeeded PaymentIntent — Stripe then
        // emails the receipt (requires "Successful payments" under Stripe →
        // Settings → Customer emails).
        if (customerEmail && !pi.receipt_email) {
          try {
            await stripe.paymentIntents.update(pi.id, { receipt_email: customerEmail });
          } catch (rcptErr) {
            console.error('Could not set receipt email:', rcptErr.message);
          }
        }

        // Decrement stock atomically. decrement_stock only applies when there's
        // enough on hand and returns the remaining count, or -1 if it couldn't
        // (a concurrent oversell). The customer has already paid, so we never
        // block — instead we flag the order for the owner to review (refund or
        // restock) rather than silently shipping stock that isn't there.
        let oversold = false;
        for (const item of order.items) {
          const { data: remaining } = await supabase.rpc('decrement_stock', { p_id: item.id, p_qty: item.qty });
          if (remaining === -1) oversold = true;
        }
        if (oversold) {
          await supabase.from('orders').update({ status: 'oversold_review' }).eq('id', orderId);
        }

        // Fulfillment is handled by hand in the Printful dashboard, so we stop
        // here with the order at 'paid' (or 'oversold_review'). The order row
        // carries everything needed to place it manually: line items with sizes,
        // the customer's shipping details, and their email.
      }
    } catch (err) {
      console.error('Order finalize error:', err.message);
    }
  }

  return res.status(200).json({ received: true });
}
