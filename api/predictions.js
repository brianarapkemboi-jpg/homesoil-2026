// ============================================================
// /api/predictions  — World Cup Pick'em
//
//   POST { email, name, picks, marketingOptIn }
//        picks = { "<matchId>": "HOME_TEAM" | "DRAW" | "AWAY_TEAM" }
//        → creates/updates the entrant's picks (one entry per email), emails a
//          welcome + discount code. Picks for matches that have already kicked
//          off are ignored (no cheating).
//
//   GET  ?leaderboard=1   → top entrants (display_name, points, correct only)
//   GET  ?email=...       → that entrant's saved picks (to view/continue)
// ============================================================
import { createClient } from '@supabase/supabase-js';
import { rateLimit, clientIp } from './_lib/ratelimit.js';
import { sendEmail, pickemWelcomeHtml } from './_lib/email.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const VALID_PICKS = new Set(['HOME_TEAM', 'DRAW', 'AWAY_TEAM']);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  // -------- GET: leaderboard or a single entry --------
  if (req.method === 'GET') {
    try {
      if (req.query?.leaderboard) {
        const { data, error } = await supabase
          .from('predictions')
          .select('display_name, points, correct')
          .order('points', { ascending: false })
          .order('correct', { ascending: false })
          .limit(50);
        if (error) throw error;
        res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
        return res.status(200).json({ leaderboard: data || [] });
      }
      const email = (req.query?.email || '').toLowerCase().trim();
      if (email) {
        const { data } = await supabase
          .from('predictions').select('display_name, picks, points, correct').eq('email', email).maybeSingle();
        return res.status(200).json({ entry: data || null });
      }
      return res.status(400).json({ error: 'Pass ?leaderboard=1 or ?email=' });
    } catch (err) {
      console.error('predictions GET error:', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // -------- POST: submit / update an entry --------
  const ip = clientIp(req);
  const { allowed } = await rateLimit(`pick:${ip}`, 10, 60); // 10/min/IP
  if (!allowed) return res.status(429).json({ error: 'Too many submissions. Please wait a minute.' });

  try {
    const { email, name, picks, marketingOptIn } = req.body || {};
    const cleanEmail = String(email || '').toLowerCase().trim();
    const cleanName = String(name || '').trim().slice(0, 40);
    if (!EMAIL_RE.test(cleanEmail)) return res.status(400).json({ error: 'Please enter a valid email.' });
    if (!cleanName) return res.status(400).json({ error: 'Please enter a display name.' });
    if (!picks || typeof picks !== 'object' || Array.isArray(picks)) {
      return res.status(400).json({ error: 'No picks provided.' });
    }

    // Only accept picks for matches that haven't started yet (anti-cheat).
    const pickedIds = Object.keys(picks).slice(0, 200);
    const { data: openMatches } = await supabase
      .from('matches').select('id, status').in('id', pickedIds);
    const openSet = new Set((openMatches || [])
      .filter(m => m.status === 'SCHEDULED' || m.status === 'TIMED')
      .map(m => m.id));

    const cleanPicks = {};
    for (const [mid, val] of Object.entries(picks)) {
      if (openSet.has(String(mid)) && VALID_PICKS.has(val)) cleanPicks[String(mid)] = val;
    }
    if (Object.keys(cleanPicks).length === 0) {
      return res.status(400).json({ error: 'No valid picks — those matches may have already started.' });
    }

    // Merge with any existing picks so a returning user adds rather than wipes.
    const { data: existing } = await supabase
      .from('predictions').select('id, picks').eq('email', cleanEmail).maybeSingle();
    const mergedPicks = { ...(existing?.picks || {}), ...cleanPicks };

    const row = {
      email: cleanEmail,
      display_name: cleanName,
      picks: mergedPicks,
      marketing_opt_in: !!marketingOptIn,
      updated_at: new Date().toISOString()
    };
    const { error } = await supabase.from('predictions').upsert(row, { onConflict: 'email' });
    if (error) throw error;

    // Welcome + discount email (best-effort; no-ops if Resend unset). Only on the
    // first entry to avoid emailing on every pick update.
    const promoCode = process.env.PROMO_CODE || '';
    const promoPercent = process.env.PROMO_PERCENT || '10';
    if (!existing) {
      sendEmail({
        to: cleanEmail,
        subject: "You're in! Your World Cup 2026 Pick'em + a discount 🎁",
        html: pickemWelcomeHtml(cleanName, promoCode, promoPercent)
      }).catch(() => {});
    }

    return res.status(200).json({ ok: true, picks: Object.keys(mergedPicks).length, promoCode: promoCode || null, promoPercent });
  } catch (err) {
    console.error('predictions POST error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
