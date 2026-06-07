# Stripe Tax setup — Home Soil 2026

The store currently charges a **flat 8%** sales tax (set in
`api/create-payment-intent.js`). That is simple but **not compliant** — real US
sales tax depends on the customer's destination and on which states you're
registered in.

The **backend for Stripe Tax is already written and deployed, but OFF by
default.** Turning it on is a deliberate, multi-step process because it touches a
live, money-taking checkout. Do **not** flip it on in production until you've
tested in Stripe **test mode**.

---

## What's already in place (dormant)
- `api/_lib/tax.js` — `calculateTax()` + `recordTaxTransaction()` (Stripe Tax Calculations API). No-ops unless `STRIPE_TAX=on`.
- `api/calculate-tax.js` — a dormant endpoint that re-prices the cart from the DB, asks Stripe Tax for the correct tax for the shipping address, updates the live PaymentIntent's amount, and syncs the order row. **Nothing calls it yet**, so it has zero effect on the current checkout.
- `api/stripe-webhook.js` — on payment success, records the Stripe Tax transaction for filing **only if** the order was priced with Stripe Tax (guarded by `metadata.tax_calculation`).
- Env flags in `.env.example`: `STRIPE_TAX`, `STRIPE_TAX_CODE`.

If `calculateTax()` is ever called while disabled or it errors, it returns
`null` and the code falls back to the flat rate — checkout never breaks.

---

## To enable (in order)

### 1. Dashboard — Stripe Tax + registrations (REQUIRED first)
1. Stripe Dashboard → **Tax** → **Enable Stripe Tax**.
2. Set your **origin address** (where you ship from) and **default product tax code**.
3. Add a **tax registration** for every state where you have nexus (at minimum your home state; add others as you cross economic-nexus thresholds).
   - ⚠️ Without a registration for a state, Stripe returns **$0 tax** there. That is *correct* — you must not collect tax where you aren't registered.

### 2. Decide the apparel tax code
- Default is `txcd_99999999` (general tangible goods).
- Several states exempt or reduce tax on clothing (PA, NJ, MN, and others). If you sell there, set `STRIPE_TAX_CODE` to a clothing-specific code from <https://stripe.com/docs/tax/tax-codes>.

### 3. Frontend wiring (NOT done yet — required)
`index.html` still computes tax client-side as `sub * 0.08` (in
`updateCheckoutSummary()`), and the PaymentIntent is created before the address
is entered. To use Stripe Tax you must:
1. After the customer fills **state + ZIP** (and on change), POST to
   `/api/calculate-tax` with `{ orderId, paymentIntentId, items, address }`.
2. Use the returned `tax` / `total` to update the order summary UI.
3. Call it once more right before `confirmPayment` so the charged amount matches.
4. For Apple/Google Pay (Express Checkout Element), recompute from the address in
   the wallet `confirm` event before confirming — and ideally reflect tax in the
   wallet sheet via `elements.update()` (this part needs the most care/testing).

Add a config flag in `STORE_CONFIG` (e.g. `stripeTax: true`) to gate the new
frontend path so you can ship it dark and flip it on after testing.

### 4. Test in Stripe TEST mode
1. Use test keys; set `STRIPE_TAX=on` in the **Preview/test** environment only.
2. Place test orders shipping to several states (one you're registered in, one you're not, one with a clothing exemption if relevant). Confirm:
   - The summary tax matches Stripe's calculation.
   - The PaymentIntent amount equals subtotal + shipping + tax.
   - After payment, **Tax → Transactions** in the dashboard shows the recorded transaction.

### 5. Go live
Only after test mode passes: set `STRIPE_TAX=on` in the **Production**
environment in Vercel and redeploy. Remove or ignore the flat-rate path once
you're confident.

---

## Quick rollback
Unset `STRIPE_TAX` (or set it to anything other than `on`) and redeploy. The
store immediately reverts to the flat 8% rate. No data migration needed.
