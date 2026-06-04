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
    const orderId = event.data.object.metadata?.order_id;
    try {
      const { data: order } = await supabase.from('orders').select('*').eq('id', orderId).single();
      if (order && order.status !== 'paid') {
        await supabase.from('orders').update({ status: 'paid' }).eq('id', orderId);

        // Decrement stock for each item
        for (const item of order.items) {
          await supabase.rpc('decrement_stock', { p_id: item.id, p_qty: item.qty });
        }

        // Hand off to Printful for fulfillment (MVP: comment out to fulfill manually)
        try {
          const pf = await createPrintfulOrder(order);
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
