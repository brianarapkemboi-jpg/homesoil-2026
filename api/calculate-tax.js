// ============================================================
// POST /api/calculate-tax   (Stripe Tax — destination-based sales tax)
//
// DORMANT until STRIPE_TAX=on AND the frontend is wired to call it after the
// customer enters their shipping address. Nothing calls it today, so deploying
// it changes no live behavior. When live it:
//   1. Re-prices the cart from the database (never trusts the browser).
//   2. Asks Stripe Tax for the correct tax for the destination address.
//   3. Updates the existing PaymentIntent's amount + stamps the calculation id
//      on its metadata (the webhook records the tax transaction on success).
//   4. Syncs the order row and returns the new tax + total for the UI.
//
// Falls back to the legacy flat rate if STRIPE_TAX is off or the calc fails, so
// checkout never breaks. See TAX-SETUP.md to enable + test in Stripe test mode.
// ============================================================
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { calculateTax } from './_lib/tax.js';
import { rateLimit, clientIp } from './_lib/ratelimit.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Must match create-payment-intent.js.
const FREE_SHIP_THRESHOLD = 75;
const FLAT_SHIPPING = 6.99;
const TAX_RATE = 0.08;  // legacy fallback only

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Same per-IP guard as checkout; a touch looser since the UI may recalc on
  // each address edit.
  const ip = clientIp(req);
  const { allowed } = await rateLimit(`tax:${ip}`, 20, 60);
  if (!allowed) return res.status(429).json({ error: 'Too many requests. Please wait a moment.' });

  try {
    const { orderId, paymentIntentId, items, address } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'Missing items' });

    // --- Re-price from the database (authoritative) ---
    const ids = items.map(i => i.id);
    const { data: dbProducts, error: dbErr } = await supabase
      .from('products').select('id, price').in('id', ids);
    if (dbErr) throw new Error('Could not load products');

    let subtotal = 0;
    const priced = [];
    for (const item of items) {
      const p = dbProducts.find(d => d.id === item.id);
      if (!p) return res.status(400).json({ error: `Unknown product: ${item.id}` });
      const qty = parseInt(item.qty, 10);
      if (!Number.isInteger(qty) || qty < 1) return res.status(400).json({ error: 'Invalid quantity' });
      subtotal += p.price * qty;
      priced.push({ id: p.id, price: p.price, qty });
    }
    const shipping = subtotal >= FREE_SHIP_THRESHOLD ? 0 : FLAT_SHIPPING;
    const shippingCents = Math.round(shipping * 100);

    // --- Tax: Stripe Tax when enabled, else legacy flat rate ---
    const calc = await calculateTax({ items: priced, shippingCents, address });

    let taxCents, totalCents, calculationId = null;
    if (calc) {
      ({ taxCents, totalCents, calculationId } = calc);
    } else {
      const flatTax = subtotal * TAX_RATE;
      taxCents = Math.round(flatTax * 100);
      totalCents = Math.round((subtotal + shipping + flatTax) * 100);
    }

    // --- Sync the live PaymentIntent so the charge matches the quote ---
    if (paymentIntentId) {
      await stripe.paymentIntents.update(paymentIntentId, {
        amount: totalCents,
        // Stripe merges metadata, so the order_id set at creation is preserved.
        ...(calculationId ? { metadata: { tax_calculation: calculationId } } : {})
      });
    }
    if (orderId) {
      await supabase.from('orders')
        .update({ tax: taxCents / 100, total: totalCents / 100 })
        .eq('id', orderId);
    }

    return res.status(200).json({
      tax: taxCents / 100,
      total: totalCents / 100,
      taxCents, totalCents,
      stripeTax: !!calc   // false = legacy flat rate was used
    });
  } catch (err) {
    console.error('calculate-tax error:', err);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
}
