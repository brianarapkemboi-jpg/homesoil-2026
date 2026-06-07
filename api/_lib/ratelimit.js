// ============================================================
// Generic per-key request rate limit (Supabase-backed, durable across the
// stateless serverless instances). Fixed window: at most `max` requests per
// `windowSeconds` for a given key (we key on the client IP).
//
// Fails OPEN: if the rate_limits table is missing or Supabase errors, the
// request is allowed rather than blocking a paying customer.
// ============================================================
import { createClient } from '@supabase/supabase-js';
import { clientIp } from './throttle.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// → { allowed: boolean }
export async function rateLimit(key, max, windowSeconds) {
  try {
    const { data, error } = await supabase.rpc('check_rate_limit', {
      p_key: key, p_max: max, p_window_seconds: windowSeconds
    });
    if (error) return { allowed: true };   // fail open
    return { allowed: data === true };
  } catch {
    return { allowed: true };              // fail open
  }
}

export { clientIp };
