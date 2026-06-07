// ============================================================
// POST /api/create-payment-intent
// Creates a Stripe PaymentIntent for the cart and records a pending order.
// The front-end (STORE_CONFIG.backendUrl) calls this when LIVE_MODE is on.
//
// SECURITY: prices are RE-COMPUTED here from your database — never trust the
// amounts sent by the browser. This prevents a customer editing the price.
// ============================================================
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { rateLimit, clientIp } from './_lib/ratelimit.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const FREE_SHIP_THRESHOLD = 75;
const FLAT_SHIPPING = 6.99;
const TAX_RATE = 0.08;

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Rate-limit checkout creation per IP, durably across serverless instances.
  // Stops PaymentIntent flooding / card-testing from spamming Stripe and the
  // orders table. Runs before any DB write so blocked requests create nothing.
  // Fails open (see _lib/ratelimit.js) so a limiter hiccup never blocks a sale.
  const ip = clientIp(req);
  const { allowed } = await rateLimit(`cpi:${ip}`, 5, 60);  // 5 per minute / IP
  if (!allowed) {
    return res.status(429).json({ error: 'Too many checkout attempts. Please wait a minute and try again.' });
  }

  try {
    const { email, items, customer, paymentMethod } = req.body || {};
    // email is optional at intent-creation time (Stripe's Payment Element mounts
    // before the customer types it); the final email is captured at confirm +
    // via the webhook. Items are required so we can price the order.
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Missing items' });
    }

    // --- Re-price from the database (authoritative) ---
    const ids = items.map(i => i.id);
    const { data: dbProducts, error: dbErr } = await supabase
      .from('products').select('id, name, price, stock').in('id', ids);
    if (dbErr) throw new Error('Could not load products');

    let subtotal = 0;
    const orderItems = [];
    for (const item of items) {
      const p = dbProducts.find(d => d.id === item.id);
      if (!p) return res.status(400).json({ error: `Unknown product: ${item.id}` });
      const qty = parseInt(item.qty, 10);
      if (!Number.isInteger(qty) || qty < 1) return res.status(400).json({ error: `Invalid quantity for ${p.name}` });
      if (p.stock < qty) return res.status(409).json({ error: `Out of stock: ${p.name}` });
      subtotal += p.price * qty;
      // Persist authoritative name/price from the DB (never the browser's
      // claimed price); keep size + qty from the request.
      orderItems.push({ id: p.id, name: p.name, price: p.price, size: item.size, qty });
    }
    const shipping = subtotal >= FREE_SHIP_THRESHOLD ? 0 : FLAT_SHIPPING;
    const tax = subtotal * TAX_RATE;
    const total = subtotal + shipping + tax;
    const amountCents = Math.round(total * 100);

    // --- Record a pending order ---
    const { data: order, error: orderErr } = await supabase
      .from('orders').insert({
        email: email || 'pending@homesoil2026.com',
        customer,
        items: orderItems,
        subtotal, shipping, tax, total,
        status: 'pending',
        payment_method: paymentMethod || 'card'
      }).select().single();
    if (orderErr) throw new Error('Could not create order');

    // --- Create the Stripe PaymentIntent ---
    const intent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: 'usd',
      ...(email ? { receipt_email: email } : {}),
      // Lets Stripe present cards, Apple Pay, Google Pay, Cash App automatically
      automatic_payment_methods: { enabled: true },
      metadata: { order_id: order.id, email }
    });

    return res.status(200).json({
      clientSecret: intent.client_secret,
      orderId: order.id,
      amount: total
    });
  } catch (err) {
    console.error('create-payment-intent error:', err);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
}
