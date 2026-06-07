// ============================================================
// Printify API helpers
// Docs: https://developers.printify.com/
//
// The owner makes designs by hand in the Printify dashboard. When a product is
// published (or via the manual "Sync from Printify" admin button), it is mapped
// into our Supabase `products` table — the single source of truth the storefront
// reads from. When a customer pays, the Stripe webhook places the matching
// Printify order for fulfillment.
//
// Required env vars (Vercel → Settings → Environment Variables):
//   PRINTIFY_API_TOKEN     Personal Access Token (Printify → My profile → Connections)
//   PRINTIFY_SHOP_ID       Your shop id (GET /v1/shops.json — or the sync endpoint lists them)
//   PRINTIFY_WEBHOOK_SECRET  (optional) shared secret used to verify webhook signatures
//   PRINTIFY_AUTO_FULFILL  'true' to send paid orders straight to production (charges you)
// ============================================================
import crypto from 'crypto';

const PRINTIFY_API = 'https://api.printify.com/v1';

export function printifyShopId() {
  return process.env.PRINTIFY_SHOP_ID;
}

async function printifyFetch(path, options = {}) {
  const res = await fetch(PRINTIFY_API + path, {
    ...options,
    headers: {
      'Authorization': `Bearer ${process.env.PRINTIFY_API_TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent': 'HomeSoil2026/1.0',
      ...(options.headers || {})
    }
  });
  // Some Printify endpoints (publishing callbacks) return an empty body on 200.
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new Error(json.message || json.error || `Printify ${res.status}`);
  }
  return json;
}

// ---------- READING THE CATALOG ----------

// List the shops connected to this token. Handy for finding PRINTIFY_SHOP_ID.
export async function listShops() {
  return printifyFetch('/shops.json');
}

// Pull EVERY product in the shop, following pagination.
export async function fetchAllProducts(shopId = printifyShopId()) {
  const all = [];
  let page = 1;
  // Printify caps limit at 100; loop until a short/empty page.
  for (;;) {
    const res = await printifyFetch(`/shops/${shopId}/products.json?page=${page}&limit=100`);
    const batch = Array.isArray(res.data) ? res.data : [];
    all.push(...batch);
    if (batch.length < 100) break;
    page += 1;
    if (page > 100) break; // safety valve
  }
  return all;
}

export async function fetchProduct(productId, shopId = printifyShopId()) {
  return printifyFetch(`/shops/${shopId}/products/${productId}.json`);
}

// ---------- MAPPING PRINTIFY -> OUR products ROW ----------

// Best-effort category from the product title so the storefront filters work.
function inferCategory(title = '') {
  const t = title.toLowerCase();
  if (/hoodie|sweatshirt|pullover|crewneck/.test(t)) return 'hoodies';
  if (/hat|cap|beanie|snapback|visor/.test(t)) return 'hats';
  if (/scarf|pin|sticker|mug|bag|tote|sock|poster|badge/.test(t)) return 'accessories';
  return 'tees';
}

// Strip the HTML Printify stores in `description` down to plain text.
function plainText(html = '') {
  return String(html)
    .replace(/<br\s*\/?>(?=\S)/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

// Turn a raw Printify product into a row matching our Supabase `products` schema.
// Print-on-demand has no real inventory, so stock is set high enough never to
// block checkout (the Stripe webhook still re-prices authoritatively).
export function mapPrintifyProduct(p, shopId = printifyShopId()) {
  const enabled = (p.variants || []).filter(v => v.is_enabled);
  const usable = enabled.length ? enabled : (p.variants || []);

  // Resolve the "Size" option so we can label variants S/M/L… for the storefront.
  const sizeOption = (p.options || []).find(o => /size/i.test(o.name) || o.type === 'size');
  const sizeValueIds = new Set((sizeOption?.values || []).map(v => v.id));
  const sizeIdToTitle = {};
  (sizeOption?.values || []).forEach(v => { sizeIdToTitle[v.id] = v.title; });

  // size title -> Printify variant id (first enabled variant for that size).
  // Used to fulfill the exact size the customer picked.
  const printify_variants = {};
  const sizes = [];
  for (const v of usable) {
    const sizeId = (v.options || []).find(id => sizeValueIds.has(id));
    const sizeTitle = sizeId != null ? sizeIdToTitle[sizeId] : (v.title || 'One Size');
    if (!(sizeTitle in printify_variants)) {
      printify_variants[sizeTitle] = v.id;
      sizes.push(sizeTitle);
    }
  }
  if (sizes.length === 0) {
    sizes.push('One Size');
    if (usable[0]) printify_variants['One Size'] = usable[0].id;
  }

  // Lowest enabled price (Printify stores prices in cents).
  const cents = usable.map(v => v.price).filter(n => Number.isFinite(n));
  const price = cents.length ? Math.min(...cents) / 100 : 0;

  // Prefer the default image, else the first.
  const img = (p.images || []).find(i => i.is_default) || (p.images || [])[0];

  return {
    id: String(p.id),
    name: p.title || 'Untitled',
    price,
    stock: 9999, // print-on-demand: effectively unlimited
    description: plainText(p.description),
    image_url: img?.src || null,
    sizes,
    category: inferCategory(p.title),
    printify_product_id: String(p.id),
    printify_shop_id: String(shopId),
    printify_blueprint_id: p.blueprint_id ?? null,
    printify_variants
  };
}

// ---------- ORDERS (FULFILLMENT) ----------

// Place a Printify order for a paid storefront order.
//   order      : the Supabase orders row (items, customer, email, id)
//   productRows: { [productId]: { printify_product_id, printify_variants } }
// Returns the created Printify order, or null if nothing in the cart is a
// Printify product (e.g. a bundle) — the caller leaves those for manual handling.
export async function createPrintifyOrder(order, productRows, shopId = printifyShopId()) {
  const line_items = [];
  for (const it of order.items || []) {
    const row = productRows[it.id];
    if (!row?.printify_product_id) continue;
    const variantId = row.printify_variants?.[it.size];
    if (!variantId) continue;
    line_items.push({
      product_id: String(row.printify_product_id),
      variant_id: Number(variantId),
      quantity: parseInt(it.qty, 10) || 1
    });
  }
  if (line_items.length === 0) return null;

  const c = order.customer || {};
  const nameParts = (c.name || '').trim().split(/\s+/);
  const first_name = nameParts.shift() || 'Customer';
  const last_name = nameParts.join(' ') || '-';
  // The checkout form only collects a single "city" field; some owners type
  // "City, ST" — split that out so Printify gets a region when available.
  const [cityPart, regionPart] = (c.city || '').split(',').map(s => (s || '').trim());

  const address_to = {
    first_name,
    last_name,
    email: order.email,
    country: 'US',
    region: regionPart || '',
    address1: c.address || '',
    city: cityPart || c.city || '',
    zip: c.zip || ''
  };

  return printifyFetch(`/shops/${shopId}/orders.json`, {
    method: 'POST',
    body: JSON.stringify({
      external_id: String(order.id),
      label: String(order.id),
      line_items,
      shipping_method: 1, // standard
      send_shipping_notification: false,
      address_to
    })
  });
}

// Submit a created order to production (this is the step that actually charges
// you and starts printing). Only called when PRINTIFY_AUTO_FULFILL === 'true'.
export async function sendToProduction(printifyOrderId, shopId = printifyShopId()) {
  return printifyFetch(`/shops/${shopId}/orders/${printifyOrderId}/send_to_production.json`, {
    method: 'POST'
  });
}

// ---------- PUBLISH CALLBACKS ----------
// For custom API stores, Printify expects the store to confirm a publish so the
// product stops showing the "Publishing…" spinner in the dashboard.
export async function publishingSucceeded(productId, external, shopId = printifyShopId()) {
  return printifyFetch(`/shops/${shopId}/products/${productId}/publishing_succeeded.json`, {
    method: 'POST',
    body: JSON.stringify({ external: external || { id: String(productId), handle: 'https://homesoil2026.com' } })
  });
}

export async function publishingFailed(productId, reason, shopId = printifyShopId()) {
  return printifyFetch(`/shops/${shopId}/products/${productId}/publishing_failed.json`, {
    method: 'POST',
    body: JSON.stringify({ reason: reason || 'Sync failed' })
  });
}

// ---------- WEBHOOKS ----------

// Register (or refresh) the webhooks Printify should send us. Idempotent-ish:
// existing webhooks for the same topic+url are left as-is.
export async function ensureWebhooks(callbackUrl, secret, shopId = printifyShopId()) {
  const topics = ['product:publish:started', 'product:deleted', 'order:shipment:created'];
  const existing = await printifyFetch(`/shops/${shopId}/webhooks.json`).catch(() => []);
  const have = new Set((Array.isArray(existing) ? existing : []).map(w => `${w.topic}|${w.url}`));
  const created = [];
  for (const topic of topics) {
    if (have.has(`${topic}|${callbackUrl}`)) { created.push({ topic, status: 'exists' }); continue; }
    const w = await printifyFetch(`/shops/${shopId}/webhooks.json`, {
      method: 'POST',
      body: JSON.stringify({ topic, url: callbackUrl, ...(secret ? { secret } : {}) })
    });
    created.push({ topic, id: w.id, status: 'created' });
  }
  return created;
}

// Verify the HMAC signature Printify sends in the `X-Pfy-Signature` header
// (format: "sha256=<hex>") over the raw request body. Returns true when no
// secret is configured so initial setup isn't blocked, but configure one.
export function verifyWebhookSignature(rawBody, signatureHeader) {
  const secret = process.env.PRINTIFY_WEBHOOK_SECRET;
  if (!secret) return true; // not configured yet — allow, but set the secret in prod
  if (!signatureHeader) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
