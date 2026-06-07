# Home Soil 2026 — Production Deployment Guide

You currently have:
- **`index.html`** — the storefront (live now in **demo mode** at https://homesoil2026.com).
- **`/api/*.js`** — serverless backend: `create-payment-intent.js` (Stripe), `stripe-webhook.js` (fulfillment trigger), `products.js` (optional Supabase catalog).
- **`supabase-schema.sql`** — the database schema.

This guide takes you from the **demo** to **taking real money and auto-fulfilling orders**.

> **Note:** you design products **by hand in Printify**. When you publish a product there it syncs to this store automatically (Supabase → storefront). See **`PRINTIFY-SETUP.md`** for the full Printify integration guide.

---

## What only YOU can do (requires your accounts)
The code is written. These steps need your logins/keys and a bank account:

1. Create accounts: **Stripe**, **PayPal Business** (optional), **Printify**, **Supabase**.
2. Connect **Stripe → your bank account** (this is how money reaches you).
3. Paste the secret keys into Vercel's environment variables (I can run `vercel env add` with you).
4. Authorize the redeploy.

---

## Step 1 — Database (Supabase) · ~5 min
1. Create a project at [supabase.com](https://supabase.com).
2. SQL Editor → paste **`supabase-schema.sql`** → Run.
3. Settings → API → copy `Project URL` and the `service_role` key (these go into Vercel).
4. Seed your 10 products (uncomment the INSERT in the SQL, or add them later via the admin).

## Step 2 — Payments (Stripe) · ~15 min
1. Create a [Stripe](https://stripe.com) account; finish "Activate payments" (business info + **bank account**).
2. Developers → API keys → copy **Secret key** (`sk_live_…`) and **Publishable key** (`pk_live_…`).
3. Apple Pay / Google Pay / Cash App: Settings → Payment methods → enable them (Stripe handles the wallets automatically via `automatic_payment_methods`).
4. **Money flow:** customer pays → Stripe → auto-payout to your bank (daily/weekly). Fee ≈ 2.9% + $0.30.

## Step 3 — Products & fulfillment (Printify, automated) · ~15 min
You design products in Printify; this store **syncs them automatically** and
**places orders for you** when customers pay. Full details in **`PRINTIFY-SETUP.md`**.
1. Create a [Printify](https://printify.com) account and design your products.
2. Printify → **My profile → Connections** → generate a **Personal Access Token** → set `PRINTIFY_API_TOKEN` in Vercel.
3. Find your shop id: from the admin, click **🔄 Sync from Printify** (or call `/api/printify-sync` with `{listShops:true}`) → set `PRINTIFY_SHOP_ID` in Vercel.
4. In the store **Admin → Products**, click **enable auto-publish webhooks** once so future Printify publishes appear instantly. Set `PRINTIFY_WEBHOOK_SECRET` to a random string first (recommended).
5. Publish a product in Printify → it appears on the store automatically. (Use **🔄 Sync from Printify** any time to pull everything in.)
6. Orders: on payment, the Stripe webhook creates the matching Printify order. Set `PRINTIFY_AUTO_FULFILL=true` to auto-send to production (charges your Printify balance); leave it unset to approve each order with one click in Printify.

## Step 4 — Deploy env vars to Vercel · ~10 min
The project is already linked to Vercel and live. To go live you only need to add secrets:
1. In Vercel → Project → Settings → **Environment Variables**, add everything from **`.env.example`** (real values) — for the **Production** environment.
   *(Or tell me the keys and I'll run `vercel env add` for each.)*
2. Stripe → Developers → Webhooks → add endpoint `https://homesoil2026.com/api/stripe-webhook`, event `payment_intent.succeeded` → copy the signing secret into `STRIPE_WEBHOOK_SECRET`.
3. Redeploy: `vercel --prod` (or I'll run it).

## Step 5 — Flip the storefront to LIVE
In `index.html`, edit **`STORE_CONFIG`** near the top of the `<script>`:
```js
const STORE_CONFIG = {
  backendUrl: 'https://homesoil2026.com',
  stripePublishableKey: 'pk_live_xxxx',
  ...
  pixels: { metaPixelId: '...', tiktokPixelId: '...', ga4Id: 'G-...' }
};
```
That single change turns on real payments. Redeploy.

> **Card field note:** for full PCI compliance, swap the plain card inputs for **Stripe Elements** (`stripe.elements()`), which tokenizes the card so raw numbers never touch your server. The backend already returns a `clientSecret` ready for it. Express wallets (Apple/Google/Cash App) need no card fields at all.

---

## Launch checklist
- [ ] Supabase schema run + products seeded
- [ ] Stripe activated + bank connected + webhook added
- [ ] Printify token + shop id set in Vercel; products designed & published in Printify, then synced (🔄 Sync from Printify) + auto-publish webhooks enabled
- [ ] Env vars set in Vercel
- [ ] `STORE_CONFIG` updated + redeployed
- [ ] Ad pixels added (Meta/TikTok/GA4) — required before running ads
- [ ] Test order with a Stripe **test** key first (card `4242 4242 4242 4242`)
- [x] Custom domain pointed (homesoil2026.com)
- [ ] Privacy + Returns + Shipping + Terms reviewed by you (templates included in the footer)

## Payments: who routes what
| Method | Routes through |
|---|---|
| Cards, Apple Pay, Google Pay, Cash App | **Stripe** |
| PayPal balance, Venmo | **PayPal Buttons SDK** (add `paypal.Buttons()` alongside Stripe) |
