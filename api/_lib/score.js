// ============================================================
// Pick'em scoring — shared so it can run automatically during a match refresh
// (no dedicated cron / serverless function needed). 3 points per correct outcome.
// Idempotent: recomputes every entry's points from FINISHED matches.
// ============================================================
const POINTS_PER_CORRECT = 3;

export async function scorePredictions(supabase) {
  const { data: finished } = await supabase
    .from('matches').select('id, winner').eq('status', 'FINISHED');
  const results = {};
  for (const m of finished || []) if (m.winner) results[m.id] = m.winner;

  const { data: entries } = await supabase.from('predictions').select('id, picks');
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
  return { scored: updated, finished: Object.keys(results).length };
}
