// ============================================================
// /api/score-predictions   (cron / manual)
// Recomputes every entrant's points from FINISHED matches: 3 points per correct
// outcome (HOME_TEAM / DRAW / AWAY_TEAM). Idempotent — safe to run any time.
//
// Optional protection: if CRON_SECRET is set, the request must send
//   Authorization: Bearer <CRON_SECRET>   (Vercel Cron does this automatically).
// Wire it up as a Vercel Cron (see vercel.json) or hit it manually after matches.
// ============================================================
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const POINTS_PER_CORRECT = 3;

export default async function handler(req, res) {
  // Auth (only enforced when CRON_SECRET is configured).
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers['authorization'] || '';
    if (auth !== `Bearer ${secret}`) return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Actual results: matchId -> winner (HOME_TEAM/AWAY_TEAM/DRAW)
    const { data: finished, error: mErr } = await supabase
      .from('matches').select('id, winner').eq('status', 'FINISHED');
    if (mErr) throw mErr;
    const results = {};
    for (const m of finished || []) if (m.winner) results[m.id] = m.winner;

    const { data: entries, error: eErr } = await supabase
      .from('predictions').select('id, picks');
    if (eErr) throw eErr;

    let updated = 0;
    for (const entry of entries || []) {
      let points = 0, correct = 0;
      for (const [mid, pick] of Object.entries(entry.picks || {})) {
        if (results[mid] && results[mid] === pick) { correct++; points += POINTS_PER_CORRECT; }
      }
      await supabase.from('predictions')
        .update({ points, correct, scored_at: new Date().toISOString() })
        .eq('id', entry.id);
      updated++;
    }

    return res.status(200).json({ ok: true, scoredEntries: updated, finishedMatches: Object.keys(results).length });
  } catch (err) {
    console.error('score-predictions error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
