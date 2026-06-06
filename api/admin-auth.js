// ============================================================
// POST /api/admin-auth
// Checks the owner password against the ADMIN_PASSWORD env var (server-side).
// The password is NEVER shipped to the browser. Fails closed if unset.
//
// Set it in Vercel → Project → Settings → Environment Variables → ADMIN_PASSWORD
// (choose any strong password; it never appears in the public code).
// ============================================================
import crypto from 'crypto';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    // Fail closed: no password configured = no access.
    return res.status(503).json({ ok: false, error: 'Admin access not configured yet. Set ADMIN_PASSWORD in Vercel.' });
  }

  const { password } = req.body || {};
  if (typeof password !== 'string' || password.length === 0) {
    return res.status(400).json({ ok: false, error: 'Password required' });
  }

  // Constant-time-ish comparison to avoid leaking length/timing.
  const a = Buffer.from(password);
  const b = Buffer.from(expected);
  const match = a.length === b.length && crypto.timingSafeEqual(a, b);

  if (match) return res.status(200).json({ ok: true });
  return res.status(401).json({ ok: false, error: 'Incorrect password' });
}
