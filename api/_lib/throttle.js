// ============================================================
// Admin auth brute-force throttle (Supabase-backed, durable across the
// stateless serverless instances). Tracks failed password attempts per client
// IP and locks the IP after too many.
//
// Fails OPEN: if the auth_throttle table is missing or Supabase errors, auth is
// allowed to proceed un-throttled rather than locking out the legitimate owner.
// ============================================================
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const MAX_FAILS = 8;       // failed attempts before a lock kicks in
const LOCK_MINUTES = 15;   // how long the IP stays locked

export function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

// → { locked: boolean, retryAfter?: seconds }
export async function checkLock(ip) {
  try {
    const { data } = await supabase.from('auth_throttle').select('locked_until').eq('ip', ip).maybeSingle();
    const until = data?.locked_until ? new Date(data.locked_until).getTime() : 0;
    if (until > Date.now()) return { locked: true, retryAfter: Math.ceil((until - Date.now()) / 1000) };
  } catch { /* fail open */ }
  return { locked: false };
}

export async function recordFailure(ip) {
  try {
    const { data } = await supabase.from('auth_throttle').select('fails').eq('ip', ip).maybeSingle();
    const fails = (data?.fails || 0) + 1;
    const locked_until = fails >= MAX_FAILS ? new Date(Date.now() + LOCK_MINUTES * 60000).toISOString() : null;
    await supabase.from('auth_throttle')
      .upsert({ ip, fails, locked_until, updated_at: new Date().toISOString() }, { onConflict: 'ip' });
  } catch { /* fail open */ }
}

export async function recordSuccess(ip) {
  try {
    await supabase.from('auth_throttle')
      .upsert({ ip, fails: 0, locked_until: null, updated_at: new Date().toISOString() }, { onConflict: 'ip' });
  } catch { /* fail open */ }
}
