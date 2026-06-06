// ============================================================
// POST /api/stripe-webhook
// Stripe calls this when a payment succeeds. This is the SOURCE OF TRUTH for
// "the customer actually paid" — never mark an order paid from the browser.
// On success: mark order paid, decrement stock, and send it to Printful.
//
// Set the webhook in Stripe → Developers → Webhooks → add endpoint:
//   https://YOUR-APP.vercel.app/api/stripe-webhook   event: payment_intent.succeeded
// ============================================================
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { createPrintfulOrder } from './_lib/printful.js';

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
      // so stock is never double-decremented and Printful never gets a dup order.
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

        // Decrement stock for each item
        for (const item of order.items) {
          await supabase.rpc('decrement_stock', { p_id: item.id, p_qty: item.qty });
        }

        // Order line items only carry storefront fields; the Printful
        // sync-variant mapping lives on the products table. Look it up so
        // fulfillment gets a real variant id instead of undefined (which makes
        // every Printful order fail and fall through to manual fulfillment).
        // NOTE: the schema stores one printful_variant_id per product, not per
        // size — drafts (confirm:false) let you correct the size on review.
        const { data: prods } = await supabase
          .from('products').select('id, printful_variant_id')
          .in('id', order.items.map(i => i.id));
        const itemsForPrintful = order.items.map(i => ({
          ...i,
          printful_variant_id: prods?.find(p => p.id === i.id)?.printful_variant_id
        }));

        // Hand off to Printful for fulfillment (MVP: comment out to fulfill manually)
        try {
          const pf = await createPrintfulOrder({ ...order, items: itemsForPrintful });
          await supabase.from('orders').update({ printful_order_id: pf.id, status: 'fulfilling' }).eq('id', orderId);
        } catch (pfErr) {
          console.error('Printful order failed (will fulfill manually):', pfErr.message);
          await supabase.from('orders').update({ status: 'needs_manual_fulfillment' }).eq('id', orderId);
        }
      }
    } catch (err) {
      console.error('Order finalize error:', err.message);
    }
  }

  return res.status(200).json({ received: true });
}
