# Session handoff — Home Soil 2026

_Last worked: 2026-06-06. Resume the Claude chat with `claude --resume` in this project._

## State of the world
- **`main` = GitHub = production** (Vercel, aliased to homesoil2026.com). All in sync.
- Branches cleaned up: only `main` remains. PR #1 and PR #2 are merged.
- The store is **LIVE** (`STORE_CONFIG.backendUrl` + `pk_live` set, so `LIVE_MODE` is on) and taking real payments via the Stripe **Payment Element** (PCI SAQ-A; raw card data never hits the server).

## ✅ Done & LIVE
- **Stripe webhook:** customer receipts (card + wallet, email backfill), idempotent finalize (no double-decrement on retries), manual Printful fulfillment (orders rest at `paid`), atomic stock decrement + `oversold_review` flagging.
- **Refunds sync:** `charge.refunded` event is enabled in Stripe (Workbench, 3 events) and the webhook flips orders to `refunded` / `partial_refund`.
- **Checkout rate-limiting:** 5 requests/min per IP on `/api/create-payment-intent` (anti-flood / anti-card-testing). Supabase-backed (`rate_limits` table + `check_rate_limit` RPC — **already run in Supabase**), `_lib/ratelimit.js`. Fails open. Verified live (6th request → 429).
- **HTTP hardening:** API CORS locked to homesoil2026.com + security headers (HSTS, X-Frame-Options, nosniff, Permissions-Policy) in `vercel.json`.
- **App hardening:** authoritative server-side pricing + quantity guards, XSS escaping on product renders, consent-gated ad pixels, admin brute-force throttle, public `/api/products` hides internal columns.
- **Legal policies expanded** (starter templates, marked "review with counsel" in a code comment in `index.html` near `LEGAL_CONTENT`):
  - Privacy: data retention (7-yr order/tax records), CCPA/CPRA "Do Not Sell or Share" (ad pixels = sharing), GPC, deletion process, children's notice.
  - Terms: 18+ eligibility, **Alabama** governing law, binding-arbitration + class-waiver clause.
  - Operator shown as the brand **"Home Soil 2026"** (LLC not formed yet); contact is **email-only** (`support@homesoil2026.com`), no postal address published.

## 🌓 Built but DORMANT — Stripe Tax (off by default)
Backend is written and deployed but inert until `STRIPE_TAX=on`. Live checkout still uses the **flat 8%** rate (`api/create-payment-intent.js`).
- `api/_lib/tax.js`, `api/calculate-tax.js` (dormant endpoint), guarded tax-transaction record in the webhook, env flags in `.env.example`.
- **To activate, follow `TAX-SETUP.md`:** enable Stripe Tax + add tax registrations (Alabama + any nexus states), wire the frontend to call `/api/calculate-tax` after the address is entered, test in Stripe **test mode**, then set `STRIPE_TAX=on` in Vercel production. Rollback = unset the flag + redeploy.

## Open — needs YOUR action / a lawyer (cannot fix in code)
- **Business structure (highest priority):** form an **LLC + liability insurance**. Once formed, swap "Home Soil 2026" → the legal entity name and add a registered/PO-box address in the policies (one quick edit in `index.html`).
- **Lawyer review** of the policy text — especially the arbitration/class-waiver clause.
- **IP/trademark:** "World Cup"/FIFA/U.S. Soccer marks. Disclaimers are in place but do NOT immunize actual infringement — get designs reviewed by IP counsel before scaling ads.
- **Sales tax:** finish the Stripe Tax activation above; the flat 8% is a placeholder, not compliant.

## Operational reminders (manual, your side)
- **Stripe → Settings → Customer emails → "Successful payments"** must be ON for receipts to send.
- In admin, fill each product's **Printful variants** field (`S:4567, M:4568, ...`) for manual fulfillment.
- Seed products in Supabase + build the Printful products with your artwork.
- Ad pixels (`metaPixelId`, etc. in `STORE_CONFIG`) are empty — add them before running ads.
- **Run one end-to-end live test order:** pay → webhook 200 → order `paid` in Supabase → receipt email → stock decrements.
- Email: ImprovMX forwarding, `support@homesoil2026.com` (live).

## Tasks I offered but haven't started (pick up here)
- Wire the frontend for Stripe Tax (the remaining half of `TAX-SETUP.md`).
- Draft the LLC-name + address swap once the entity exists.
