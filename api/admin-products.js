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
  if (!passwordOk(password)) return res.status(401).json({ ok: false, error: 'Not authorized' });

  try {
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
      category: p.category ? String(p.category) : null
    }));

    const { error } = await supabase.from('products').upsert(clean, { onConflict: 'id' });
    if (error) throw error;
    return res.status(200).json({ ok: true, saved: clean.length });
  } catch (err) {
    console.error('admin-products error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
