# Printify Integration — Setup Guide

You design products **by hand in Printify**. This store then:

1. **Syncs** those products into Supabase (the storefront reads from Supabase).
2. **Publishes** them on the website automatically when you publish in Printify.
3. **Places the Printify order** for you when a customer pays.

There is no design work in this codebase — just the plumbing that connects
Printify → Supabase → the storefront → fulfillment.

---

## How it flows

```
            you click "Publish" in Printify
                       │
        product:publish:started webhook
                       │
        /api/printify-webhook  ──►  upsert into Supabase `products`
                       │                       │
        publishing_succeeded ◄─────────────────┘
                                               │
                          storefront /api/products reads Supabase
                                               │
                                customer buys + pays (Stripe)
                                               │
                          /api/stripe-webhook  ──►  createPrintifyOrder()
                                               │
                       (optional) send_to_production → printed & shipped
```

`🔄 Sync from Printify` in the admin does the same upsert for **every** product
at once — use it for the initial load or any time you want a full refresh.

---

## One-time setup

### 1. Get your Printify token
Printify → **My profile → Connections** → **Personal Access Tokens** → Generate.
Copy it into Vercel as `PRINTIFY_API_TOKEN`.

### 2. Find your shop id
Either:
- From the storefront admin, open **Manage Products** and click **🔄 Sync from
  Printify** — if the shop id isn't set yet the error tells you to look it up; or
- `POST /api/printify-sync` with body `{ "password": "<ADMIN_PASSWORD>", "listShops": true }`, or
- `GET https://api.printify.com/v1/shops.json` with the token as a Bearer header.

Set the numeric id as `PRINTIFY_SHOP_ID` in Vercel.

### 3. (Recommended) Set a webhook secret
Set `PRINTIFY_WEBHOOK_SECRET` to any random string in Vercel. The webhook
receiver uses it to verify that calls really come from Printify. If it's unset,
the receiver accepts unsigned calls so you're not blocked during setup — but set
it before launch.

### 4. Register the webhooks
In the admin (**Manage Products**) click **enable auto-publish webhooks**, or
`POST /api/printify-register-webhooks` with `{ "password": "<ADMIN_PASSWORD>" }`.
This registers, on your shop:
- `product:publish:started` → auto-sync on publish
- `product:deleted` → auto-remove from the store
- `order:shipment:created` → acknowledged (extend later for tracking emails)

The callback URL is derived from the request host, so it works on any Vercel
domain (defaults to `https://homesoil2026.com/api/printify-webhook`).

### 5. Run the DB migration
Run `supabase-schema.sql` in the Supabase SQL editor (it's safe to re-run — it
only adds the new `printify_*` columns and an index if missing).

---

## Daily use

- **Add a product:** design it in Printify and click **Publish**. It appears on
  the store within seconds (via the webhook). If it doesn't, click **🔄 Sync
  from Printify** in the admin.
- **Edit price/stock locally:** you can override price in the admin and **💾 Save
  to Live Store**. A later sync will pull Printify's price again, so prefer
  setting your retail price in Printify.
- **Remove a product:** delete/unpublish it in Printify (auto-removed), or delete
  it in the admin.

---

## Fulfillment behavior

When a payment succeeds, `stripe-webhook.js` looks up each cart item's
`printify_product_id` + `printify_variants[size]` and creates the Printify order
(`external_id` = your order id), storing `printify_order_id` on the order and
setting its status to `fulfilling`.

- `PRINTIFY_AUTO_FULFILL=true` → also calls `send_to_production` (this charges
  your Printify balance and starts printing immediately).
- Unset → the order sits in Printify for you to approve with one click.

If Printify errors, the storefront order stays `paid` and is logged — place it by
hand in Printify. Bundles or any cart item without a `printify_product_id` are
skipped (handle those manually).

---

## Notes & limits

- **Stock:** print-on-demand has no real inventory, so synced products get a high
  nominal stock (9999) that never blocks checkout.
- **Sizes vs. colors:** the storefront sells by **size**. The sync maps each size
  to the first enabled Printify variant for that size. If a product has multiple
  colors you want to sell separately, create them as separate Printify products.
- **Address/region:** the checkout collects name/address/city/zip. If you need a
  state for shipping, type it into the city field as `City, ST` — the order
  builder splits it into Printify's `region`.
- **Categories:** inferred from the product title (hoodie/hat/scarf/pin → the
  matching storefront filter, else `tees`). Rename in Printify or edit in the
  admin to change it.
