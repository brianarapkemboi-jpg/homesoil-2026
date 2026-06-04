// ============================================================
// Printful API helpers
// Docs: https://developers.printful.com/docs/
// Each store product must be mapped to a Printful "sync variant id".
// Store that mapping in your products table as `printful_variant_id`.
// ============================================================
const PRINTFUL_API = 'https://api.printful.com';

async function printfulFetch(path, options = {}) {
  const res = await fetch(PRINTFUL_API + path, {
    ...options,
    headers: {
      'Authorization': `Bearer ${process.env.PRINTFUL_API_TOKEN}`,
      'X-PF-Store-Id': process.env.PRINTFUL_STORE_ID,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message || `Printful ${res.status}`);
  return json.result;
}

// Create a fulfillment order from a paid store order.
export async function createPrintfulOrder(order) {
  const recipient = {
    name: order.customer?.name,
    address1: order.customer?.address,
    city: (order.customer?.city || '').split(',')[0]?.trim(),
    state_code: ((order.customer?.city || '').split(',')[1] || '').trim(),
    country_code: 'US',
    zip: order.customer?.zip,
    email: order.email
  };

  // Map each cart item to a Printful sync variant.
  // (Your products table should carry printful_variant_id per size.)
  const items = order.items.map(i => ({
    sync_variant_id: i.printful_variant_id, // ensure this is included when building the order
    quantity: i.qty
  }));

  return printfulFetch('/orders', {
    method: 'POST',
    body: JSON.stringify({
      recipient,
      items,
      // confirm:false = draft (review in dashboard). Set true to auto-submit to production.
      confirm: false
    })
  });
}

// Upload a print file + create a new sync product (used by the Design Studio).
export async function createPrintfulProduct({ name, imageUrl, blueprintVariantIds, retailPrice }) {
  // blueprintVariantIds = the Printful catalog variant ids for the chosen garment/sizes
  const sync_variants = blueprintVariantIds.map(vid => ({
    variant_id: vid,
    retail_price: String(retailPrice),
    files: [{ url: imageUrl }] // Printful pulls the print file from this URL
  }));

  return printfulFetch('/store/products', {
    method: 'POST',
    body: JSON.stringify({
      sync_product: { name },
      sync_variants
    })
  });
}

// Generate a mockup preview for a design on a product.
export async function generateMockup(productId, variantIds, imageUrl) {
  const task = await printfulFetch(`/mockup-generator/create-task/${productId}`, {
    method: 'POST',
    body: JSON.stringify({
      variant_ids: variantIds,
      format: 'jpg',
      files: [{ placement: 'front', image_url: imageUrl }]
    })
  });
  return task; // poll /mockup-generator/task?task_key=... for the result
}
