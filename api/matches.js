// ============================================================
// GET /api/matches
// Returns the 2026 World Cup schedule/scores (from the Supabase cache) plus
// computed group standings. Refreshes the cache from football-data.org when it's
// stale — gated by a timestamp so a traffic burst can't blow the API rate limit.
// Works on any Vercel plan (no cron required); set FOOTBALL_DATA_TOKEN to enable
// live data, otherwise it serves whatever is cached (empty until first refresh).
//
//   /api/matches            → { matches, standings, updatedAt }
//   /api/matches?refresh=1  → force a refresh (used by the optional cron)
// ============================================================
import { createClient } from '@supabase/supabase-js';
import { fetchMatches, computeStandings } from './_lib/football.js';
import { scorePredictions } from './_lib/score.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// How long a cache copy is considered fresh. Short during the tournament so live
// scores update; the timestamp gate still protects the upstream rate limit.
const FRESH_SECONDS = 90;

async function lastRefresh() {
  const { data } = await supabase.from('app_state').select('value').eq('key', 'matches_refreshed_at').maybeSingle();
  return data?.value ? new Date(data.value).getTime() : 0;
}
async function markRefreshed() {
  await supabase.from('app_state').upsert(
    { key: 'matches_refreshed_at', value: new Date().toISOString(), updated_at: new Date().toISOString() },
    { onConflict: 'key' }
  );
}

async function refreshFromProvider() {
  const rows = await fetchMatches();           // throws if token missing / API error
  if (rows.length) {
    await supabase.from('matches').upsert(rows, { onConflict: 'id' });
  }
  await markRefreshed();
}

// Re-score the Pick'em leaderboard, but only when the number of FINISHED matches
// has changed since we last scored — so we don't re-score on every refresh.
// This replaces a dedicated cron (keeps us under the Hobby function limit).
async function maybeScorePredictions() {
  try {
    const { count } = await supabase
      .from('matches').select('id', { count: 'exact', head: true }).eq('status', 'FINISHED');
    const { data } = await supabase.from('app_state').select('value').eq('key', 'scored_finished_count').maybeSingle();
    const prev = data?.value != null ? parseInt(data.value, 10) : -1;
    if ((count || 0) !== prev) {
      await scorePredictions(supabase);
      await supabase.from('app_state').upsert(
        { key: 'scored_finished_count', value: String(count || 0), updated_at: new Date().toISOString() },
        { onConflict: 'key' }
      );
    }
  } catch (e) { console.error('auto-score skipped:', e.message); }
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const force = req.query?.refresh === '1';
    const age = (Date.now() - (await lastRefresh())) / 1000;
    if (force || age > FRESH_SECONDS) {
      // Best-effort: if the refresh fails (no token / rate limited), fall back to
      // whatever is cached so the page still renders.
      try { await refreshFromProvider(); await maybeScorePredictions(); }
      catch (e) { console.error('matches refresh skipped:', e.message); }
    }

    const { data: matches, error } = await supabase
      .from('matches')
      .select('id, utc_date, matchday, stage, group_name, home, away, home_code, away_code, home_flag, away_flag, home_score, away_score, status, winner, venue')
      .order('utc_date', { ascending: true });
    if (error) throw error;

    const standings = computeStandings(matches || []);
    // Cache at the edge for a short time to absorb traffic spikes.
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
    return res.status(200).json({ matches: matches || [], standings, updatedAt: new Date().toISOString() });
  } catch (err) {
    console.error('matches error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
