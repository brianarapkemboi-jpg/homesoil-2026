// ============================================================
// POST /api/admin-products   (owner only)
// Saves product edits to Supabase — the single source of truth for the store.
// Requires the owner password (checked server-side against ADMIN_PASSWORD).
//
// Body:
//   { password, products: [ {id,name,price,stock,description,image_url,sizes,category}, ... ] }
//     → upserts every product (insert new / update existing by id)
//   { password, deleteId: 'hs-...' }
//     → deletes one product
// ============================================================
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { clientIp, checkLock, recordFailure, recordSuccess } from './_lib/throttle.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

function passwordOk(pw) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected || typeof pw !== 'string') return false;
  const a = Buffer.from(pw), b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const { password, products, deleteId } = req.body || {};

  // Throttle brute-force attempts per IP.
  const ip = clientIp(req);
  const lock = await checkLock(ip);
  if (lock.locked) {
    return res.status(429).json({ ok: false, error: `Too many attempts. Try again in ${Math.ceil(lock.retryAfter / 60)} min.` });
  }
  if (!passwordOk(password)) {
    await recordFailure(ip);
    return res.status(401).json({ ok: false, error: 'Not authorized' });
  }
  await recordSuccess(ip);

  try {
    // --- Read the full catalog (admin only; includes internal columns like
    //     printify_variants that the public /api/products endpoint hides) ---
    if (!products && !deleteId) {
      const { data, error } = await supabase
        .from('products').select('*').order('created_at', { ascending: true });
      if (error) throw error;
      // Full rows incl. the hidden Printify mapping (printify_variants etc.).
      return res.status(200).json({ ok: true, products: data });
    }

    // --- Delete one product ---
    if (deleteId) {
      const { error } = await supabase.from('products').delete().eq('id', deleteId);
      if (error) throw error;
      return res.status(200).json({ ok: true, deleted: deleteId });
    }

    // --- Upsert the catalog ---
    if (!Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ ok: false, error: 'No products provided' });
    }
    // Keep only known columns and coerce types so a typo can't corrupt the table.
    const clean = products.map(p => ({
      id: String(p.id),
      name: String(p.name || 'Untitled'),
      price: Number(p.price) || 0,
      stock: parseInt(p.stock, 10) || 0,
      description: p.description ? String(p.description) : null,
      image_url: p.image_url ? String(p.image_url) : null,
      sizes: Array.isArray(p.sizes) ? p.sizes : [],
      category: p.category ? String(p.category) : null,
      // Printify fulfillment mapping. Synced automatically from Printify, but
      // round-tripped here so an admin save never wipes it. printify_variants is
      // a per-size variant map, e.g. {"S":4567,"M":4568}.
      printify_product_id: p.printify_product_id ? String(p.printify_product_id) : null,
      printify_variants: (p.printify_variants && typeof p.printify_variants === 'object' && !Array.isArray(p.printify_variants))
        ? p.printify_variants : {},
      // Public colour/size matrix (auto-synced from Printify); round-tripped so
      // an admin save never wipes it.
      variant_options: (p.variant_options && typeof p.variant_options === 'object' && !Array.isArray(p.variant_options))
        ? p.variant_options : {}
    }));

    const { error } = await supabase.from('products').upsert(clean, { onConflict: 'id' });
    if (error) throw error;
    return res.status(200).json({ ok: true, saved: clean.length });
  } catch (err) {
    console.error('admin-products error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
