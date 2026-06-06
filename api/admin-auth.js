// ============================================================
// POST /api/admin-auth
// Checks the owner password against the ADMIN_PASSWORD env var (server-side).
// The password is NEVER shipped to the browser. Fails closed if unset.
//
// Set it in Vercel → Project → Settings → Environment Variables → ADMIN_PASSWORD
// (choose any strong password; it never appears in the public code).
// ============================================================
import crypto from 'crypto';
import { clientIp, checkLock, recordFailure, recordSuccess } from './_lib/throttle.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    // Fail closed: no password configured = no access.
    return res.status(503).json({ ok: false, error: 'Admin access not configured yet. Set ADMIN_PASSWORD in Vercel.' });
  }

  // Throttle brute-force attempts per IP before doing any work.
  const ip = clientIp(req);
  const lock = await checkLock(ip);
  if (lock.locked) {
    return res.status(429).json({ ok: false, error: `Too many attempts. Try again in ${Math.ceil(lock.retryAfter / 60)} min.` });
  }

  const { password } = req.body || {};
  if (typeof password !== 'string' || password.length === 0) {
    return res.status(400).json({ ok: false, error: 'Password required' });
  }

  // Constant-time-ish comparison to avoid leaking length/timing.
  const a = Buffer.from(password);
  const b = Buffer.from(expected);
  const match = a.length === b.length && crypto.timingSafeEqual(a, b);

  if (match) {
    await recordSuccess(ip);
    return res.status(200).json({ ok: true });
  }
  await recordFailure(ip);
  return res.status(401).json({ ok: false, error: 'Incorrect password' });
}
