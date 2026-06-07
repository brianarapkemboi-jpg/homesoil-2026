# Fan Engagement Features — Setup

Four features that turn one-time merch buyers into daily visitors on your email list:

1. **Match Center** — live scores, full schedule, group standings.
2. **Pick'em Challenge** — fans predict matches, climb a leaderboard, capture emails, auto-discount.
3. **Game-Day Drop banner** — next-match countdown that drives the matchday merch CTA.
4. **Stadium Guide** — the 16 host venues (static; works immediately).

Everything runs on your existing stack (Supabase + Vercel + Resend + Stripe). Each piece degrades gracefully if its data source isn't configured yet.

---

## 1. Run the database migration
Supabase → SQL Editor → run **`worldcup-features-schema.sql`** (safe to re-run). It adds `matches`, `app_state`, and `predictions` tables.

## 2. Connect the football data feed (Match Center + Pick'em)
1. Register for a free token at <https://www.football-data.org/client/register>.
2. Set **`FOOTBALL_DATA_TOKEN`** in Vercel → Settings → Environment Variables → Production.
3. Redeploy. Visiting `/api/matches` will pull the World Cup (`WC`) schedule, cache it in Supabase, and refresh on a stale read (no cron needed). The Match Center and Pick'em populate automatically.

> No token yet? The sections show a friendly "coming soon" state and the rest of the site is unaffected. The **Stadium Guide works with no setup.**

## 3. Pick'em discount + emails (optional but recommended)
- **`PROMO_CODE`** (e.g. `PICKEM10`) and **`PROMO_PERCENT`** (e.g. `10`) — the code emailed to entrants and honored at checkout (validated server-side in `create-payment-intent.js`).
- **`RESEND_API_KEY`** + **`STORE_FROM_EMAIL`** — so entrants get the welcome + discount email. Without Resend, entries still save; they just don't get an email.

## 4. Leaderboard scoring
Scoring is **automatic** — no cron required. Whenever `/api/matches` refreshes and
detects a newly FINISHED match, it recomputes every entrant's points (3 pts per
correct outcome). Because fans hit the Match Center regularly, the leaderboard
stays current on its own. (Keeping scoring out of a dedicated function also keeps
us under the Vercel Hobby 12-function limit.)
- Manual trigger if you ever want it: `GET /api/predictions?score=1` (add
  `?key=<CRON_SECRET>` or an `Authorization: Bearer <CRON_SECRET>` header if
  `CRON_SECRET` is set).

---

## How it behaves
- **Match Center:** `/api/matches` always serves the Supabase cache (so it's fast and survives API rate limits) and refreshes when the cache is older than ~90s.
- **Anti-cheat:** Pick'em only accepts predictions for matches that haven't kicked off; returning users can add picks without wiping earlier ones (one entry per email).
- **Leaderboard** exposes only display name + points (never emails).
- **Game-day banner** shows the soonest upcoming match (prefers a USA fixture) with a live countdown linking to the shop.

## Legal
Keep the existing "fan-inspired, not affiliated with FIFA/U.S. Soccer" disclaimers. The football data API provides factual fixtures/scores (not official marks). Don't display official competition logos/emblems.
