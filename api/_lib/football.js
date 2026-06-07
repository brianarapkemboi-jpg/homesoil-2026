// ============================================================
// Football data client — 2026 FIFA World Cup
// Source: football-data.org (free tier). Get a token at
//   https://www.football-data.org/client/register
// and set FOOTBALL_DATA_TOKEN in Vercel. The free tier is rate-limited
// (~10 req/min), so /api/matches caches results in Supabase and only refreshes
// when the cache is stale.
//
// Competition code for the World Cup is "WC".
// ============================================================
const API = 'https://api.football-data.org/v4';
const COMPETITION = 'WC';

function authHeaders() {
  return { 'X-Auth-Token': process.env.FOOTBALL_DATA_TOKEN || '' };
}

// Map the provider's match shape to our flat `matches` row.
function normalizeMatch(m) {
  return {
    id: String(m.id),
    utc_date: m.utcDate || null,
    matchday: m.matchday ?? null,
    stage: m.stage || null,
    group_name: m.group || null,
    home: m.homeTeam?.name || m.homeTeam?.shortName || 'TBD',
    away: m.awayTeam?.name || m.awayTeam?.shortName || 'TBD',
    home_code: m.homeTeam?.tla || null,
    away_code: m.awayTeam?.tla || null,
    home_flag: m.homeTeam?.crest || null,
    away_flag: m.awayTeam?.crest || null,
    home_score: m.score?.fullTime?.home ?? null,
    away_score: m.score?.fullTime?.away ?? null,
    status: m.status || 'SCHEDULED',
    winner: m.score?.winner || null,
    venue: m.venue || null,
    updated_at: new Date().toISOString()
  };
}

// Pull every World Cup match from the provider (normalized). Throws on error so
// the caller can fall back to the cached copy.
export async function fetchMatches() {
  if (!process.env.FOOTBALL_DATA_TOKEN) {
    throw new Error('FOOTBALL_DATA_TOKEN not set');
  }
  const res = await fetch(`${API}/competitions/${COMPETITION}/matches`, { headers: authHeaders() });
  const text = await res.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = {}; }
  if (!res.ok) throw new Error(json.message || `football-data ${res.status}`);
  const matches = Array.isArray(json.matches) ? json.matches : [];
  return matches.map(normalizeMatch);
}

// Build group-stage standings purely from finished/in-play matches so we don't
// need a second API call (and so it always matches the scores we display).
// Returns { "Group A": [ {team, code, flag, played, won, drawn, lost, gf, ga, gd, points}, ... ], ... }
export function computeStandings(matches) {
  const groups = {};
  const ensure = (group, name, code, flag) => {
    groups[group] = groups[group] || {};
    if (!groups[group][name]) {
      groups[group][name] = { team: name, code: code || null, flag: flag || null, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0, points: 0 };
    }
    return groups[group][name];
  };

  for (const m of matches) {
    if (!m.group_name) continue;                 // group stage only
    if (m.status !== 'FINISHED' && m.status !== 'IN_PLAY' && m.status !== 'PAUSED') continue;
    if (m.home_score == null || m.away_score == null) continue;
    if (m.home === 'TBD' || m.away === 'TBD') continue;

    const h = ensure(m.group_name, m.home, m.home_code, m.home_flag);
    const a = ensure(m.group_name, m.away, m.away_code, m.away_flag);
    h.played++; a.played++;
    h.gf += m.home_score; h.ga += m.away_score;
    a.gf += m.away_score; a.ga += m.home_score;
    if (m.home_score > m.away_score) { h.won++; a.lost++; h.points += 3; }
    else if (m.home_score < m.away_score) { a.won++; h.lost++; a.points += 3; }
    else { h.drawn++; a.drawn++; h.points++; a.points++; }
  }

  const out = {};
  for (const g of Object.keys(groups).sort()) {
    out[g] = Object.values(groups[g]).map(t => ({ ...t, gd: t.gf - t.ga }))
      .sort((x, y) => y.points - x.points || y.gd - x.gd || y.gf - x.gf || x.team.localeCompare(y.team));
  }
  return out;
}
