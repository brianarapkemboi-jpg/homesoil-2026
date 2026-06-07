// ============================================================
// POST /api/printify-sync   (owner only)
// Pulls the full catalog from Printify and upserts it into Supabase, so the
// storefront reflects whatever you've designed/published in the Printify
// dashboard. Run it any time from the admin's "Sync from Printify" button.
//
// Body:
//   { password }                      → sync every product from the shop
//   { password, listShops: true }     → return the shops on your token (to find
//                                        PRINTIFY_SHOP_ID the first time)
//
// Real-time publishing is handled separately by /api/printify-webhook; this
// endpoint is the manual / first-load fallback and a way to re-sync on demand.
// ============================================================
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { clientIp, checkLock, recordFailure, recordSuccess } from './_lib/throttle.js';
import { fetchAllProducts, mapPrintifyProduct, listShops, printifyShopId } from './_lib/printify.js';

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

  const { password, listShops: wantShops } = req.body || {};

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

  if (!process.env.PRINTIFY_API_TOKEN) {
    return res.status(503).json({ ok: false, error: 'PRINTIFY_API_TOKEN not set in Vercel.' });
  }

  try {
    // First-run helper: list shops so the owner can grab their PRINTIFY_SHOP_ID.
    if (wantShops) {
      const shops = await listShops();
      return res.status(200).json({ ok: true, shops });
    }

    if (!printifyShopId()) {
      return res.status(503).json({ ok: false, error: 'PRINTIFY_SHOP_ID not set. Call with {listShops:true} to find it.' });
    }

    const raw = await fetchAllProducts();
    const rows = raw
      .filter(p => p.visible !== false) // skip hidden/unpublished drafts
      .map(p => mapPrintifyProduct(p));

    if (rows.length === 0) {
      return res.status(200).json({ ok: true, synced: 0, note: 'No visible products found in the Printify shop.' });
    }

    const { error } = await supabase.from('products').upsert(rows, { onConflict: 'id' });
    if (error) throw error;

    return res.status(200).json({ ok: true, synced: rows.length, ids: rows.map(r => r.id) });
  } catch (err) {
    console.error('printify-sync error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
