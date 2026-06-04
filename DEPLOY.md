# Home Soil 2026 — Production Deployment Guide

You currently have:
- **`index.html`** — the storefront (works standalone in demo mode; live now on GitHub Pages).
- **`/api/*.js`** — serverless backend (Stripe payments, Printful fulfillment, Grok design generation).
- **`supabase-schema.sql`** — the database.

This guide takes you from the **demo** to **taking real money and auto-fulfilling orders**.

> **Key concept:** GitHub Pages can only host the static `index.html` — it cannot run the `/api` backend. To go live you deploy the whole repo to **Vercel** (free tier is fine), which serves the page *and* runs the functions. GitHub Pages can stay as a demo mirror.

---

## What only YOU can do (requires your accounts)
I've written all the code. These steps need your logins/keys and a bank account — I can't do them for you:

1. Create accounts: **Stripe**, **PayPal Business**, **Printful**, **xAI (Grok)**, **Supabase**.
2. Connect **Stripe → your bank account** (this is literally how money reaches you).
3. Paste the secret keys into Vercel's environment variables.
4. Authorize the Vercel deploy.

---

## Step 1 — Database (Supabase) · ~5 min
1. Create a project at [supabase.com](https://supabase.com).
2. SQL Editor → paste **`supabase-schema.sql`** → Run.
3. Settings → API → copy `Project URL` and `service_role` key (you'll add these to Vercel).
4. Seed your 10 products (uncomment the INSERT in the SQL, or add them later via the admin).

## Step 2 — Payments (Stripe) · ~15 min
1. Create a [Stripe](https://stripe.com) account; finish "Activate payments" (business info + **bank account**).
2. Developers → API keys → copy **Secret key** (`sk_live_…`) and **Publishable key** (`pk_live_…`).
3. Apple Pay / Google Pay / Cash App: Settings → Payment methods → enable them (Stripe handles the wallets automatically via `automatic_payment_methods`).
4. **Money flow:** customer pays → Stripe → auto-payout to your bank (daily/weekly). Fee ≈ 2.9% + $0.30.

## Step 3 — Fulfillment (Printful) · ~20 min
1. Create a [Printful](https://printful.com) account.
2. Build each product once in Printful (pick garment, upload/confirm the design) → note each **sync variant id** per size.
3. Put those ids in your `products.printful_variant_id` (Supabase) and in `GARMENT_VARIANTS` in `api/create-printful-product.js`.
4. Settings → Stores → API → create a token → copy `PRINTFUL_API_TOKEN` + store id.
5. **MVP shortcut:** leave `confirm:false` in `_lib/printful.js` so orders arrive as *drafts* you approve by hand. Flip to `true` later for full auto-pilot.

## Step 4 — AI Designs (xAI Grok) · ~5 min
1. Get an API key at [console.x.ai](https://console.x.ai) → `XAI_API_KEY`.
2. (Recommended) add an upscale + background-removal step in `api/generate-design.js` before sending to Printful — AI output is ~1024px and print needs 300 DPI.

## Step 5 — Deploy to Vercel · ~10 min
1. Install: `npm i -g vercel`
2. From this folder: `vercel` (links the repo) then `vercel --prod`.
3. In Vercel → Project → Settings → **Environment Variables**, add everything from **`.env.example`** (real values).
4. Stripe → Developers → Webhooks → add endpoint `https://YOUR-APP.vercel.app/api/stripe-webhook`, event `payment_intent.succeeded` → copy the signing secret into `STRIPE_WEBHOOK_SECRET`.

## Step 6 — Flip the storefront to LIVE
In `index.html`, edit **`STORE_CONFIG`** near the top of the `<script>`:
```js
const STORE_CONFIG = {
  backendUrl: 'https://YOUR-APP.vercel.app',
  stripePublishableKey: 'pk_live_xxxx',
  ...
  pixels: { metaPixelId: '...', tiktokPixelId: '...', ga4Id: 'G-...' }
};
```
That single change turns on real payments and live design generation. Redeploy.

> **Card field note:** for full PCI compliance, swap the plain card inputs for **Stripe Elements** (`stripe.elements()`), which tokenizes the card so raw numbers never touch your server. The backend already returns a `clientSecret` ready for it. Express wallets (Apple/Google/Cash App) need no card fields at all.

---

## Launch checklist
- [ ] Supabase schema run + products seeded
- [ ] Stripe activated + bank connected + webhook added
- [ ] Printful products mapped (variant ids)
- [ ] Env vars set in Vercel
- [ ] `STORE_CONFIG` updated + redeployed
- [ ] Ad pixels added (Meta/TikTok/GA4) — required before running ads
- [ ] Test order with a Stripe **test** key first (card `4242 4242 4242 4242`)
- [ ] Custom domain pointed (e.g. homesoil2026.com)
- [ ] Privacy + Returns + Shipping + Terms reviewed by you (templates included in the footer)

## Payments: who routes what
| Method | Routes through |
|---|---|
| Cards, Apple Pay, Google Pay, Cash App | **Stripe** |
| PayPal balance, Venmo | **PayPal Buttons SDK** (add `paypal.Buttons()` alongside Stripe) |
