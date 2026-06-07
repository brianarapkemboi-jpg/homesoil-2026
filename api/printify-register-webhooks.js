// ============================================================
// POST /api/printify-register-webhooks   (owner only)
// One-click setup: tells Printify to send product publish/delete events to our
// /api/printify-webhook endpoint. Run this once after deploying (the admin has a
// button for it). Safe to re-run — existing webhooks for the same topic+url are
// left in place.
//
// Body: { password }
// Uses PRINTIFY_WEBHOOK_SECRET (if set) so the receiver can verify signatures.
// ============================================================
import crypto from 'crypto';
import { clientIp, checkLock, recordFailure, recordSuccess } from './_lib/throttle.js';
import { ensureWebhooks, printifyShopId } from './_lib/printify.js';

function passwordOk(pw) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected || typeof pw !== 'string') return false;
  const a = Buffer.from(pw), b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const { password } = req.body || {};

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

  if (!process.env.PRINTIFY_API_TOKEN || !printifyShopId()) {
    return res.status(503).json({ ok: false, error: 'Set PRINTIFY_API_TOKEN and PRINTIFY_SHOP_ID in Vercel first.' });
  }

  try {
    // Derive the public callback URL from the request host (works on any Vercel
    // domain). Falls back to the production domain.
    const host = req.headers['x-forwarded-host'] || req.headers.host || 'homesoil2026.com';
    const callbackUrl = `https://${host}/api/printify-webhook`;
    const result = await ensureWebhooks(callbackUrl, process.env.PRINTIFY_WEBHOOK_SECRET);
    return res.status(200).json({ ok: true, callbackUrl, webhooks: result });
  } catch (err) {
    console.error('printify-register-webhooks error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
