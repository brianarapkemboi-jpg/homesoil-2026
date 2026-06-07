// ============================================================
// POST /api/printify-webhook
// Printify calls this when you publish or delete a product in the dashboard.
// This is the live link that makes "design in Printify → appears on the site"
// happen automatically:
//
//   product:publish:started → fetch the product, upsert it into Supabase, then
//                             tell Printify the publish succeeded (clears the
//                             "Publishing…" state in the dashboard).
//   product:deleted         → remove it from Supabase so it drops off the store.
//
// Register the endpoint once via /api/printify-register-webhooks (or in the
// Printify dashboard). Set PRINTIFY_WEBHOOK_SECRET to verify signatures.
// ============================================================
import { createClient } from '@supabase/supabase-js';
import {
  fetchProduct, mapPrintifyProduct, publishingSucceeded, verifyWebhookSignature
} from './_lib/printify.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Disable Vercel's body parser so we can verify the raw HMAC signature.
export const config = { api: { bodyParser: false } };

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => (data += chunk));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const raw = await readRawBody(req);
  if (!verifyWebhookSignature(raw, req.headers['x-pfy-signature'])) {
    console.error('Printify webhook: bad signature');
    return res.status(401).json({ error: 'Bad signature' });
  }

  let event;
  try { event = JSON.parse(raw); } catch { return res.status(400).json({ error: 'Bad JSON' }); }

  // Printify payloads carry the topic on `type` and the subject under `resource`.
  const topic = event.type || event.topic;
  const productId = event.resource?.id || event.resource?.data?.id || event.id;

  try {
    if (topic === 'product:publish:started') {
      const p = await fetchProduct(productId);
      const row = mapPrintifyProduct(p);
      const { error } = await supabase.from('products').upsert(row, { onConflict: 'id' });
      if (error) throw error;
      // Confirm the publish so Printify clears the spinner. Best-effort: never
      // fail the webhook over the callback.
      try {
        await publishingSucceeded(productId, { id: row.id, handle: 'https://homesoil2026.com' });
      } catch (cbErr) {
        console.error('publishing_succeeded callback failed:', cbErr.message);
      }
      return res.status(200).json({ ok: true, synced: row.id });
    }

    if (topic === 'product:deleted' || topic === 'product:unpublished') {
      await supabase.from('products').delete().eq('printify_product_id', String(productId));
      return res.status(200).json({ ok: true, deleted: String(productId) });
    }

    // Any other topic (e.g. order:shipment:created) — acknowledge so Printify
    // doesn't retry. Shipment handling can be added here later if desired.
    return res.status(200).json({ ok: true, ignored: topic });
  } catch (err) {
    console.error('printify-webhook error:', err.message);
    // 500 → Printify retries with backoff, which is what we want on a transient
    // Supabase/Printify hiccup.
    return res.status(500).json({ ok: false, error: err.message });
  }
}
