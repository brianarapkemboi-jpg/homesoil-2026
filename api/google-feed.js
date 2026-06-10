// ============================================================
// GET /api/google-feed  (served as /feed.xml — see vercel.json)
// Generates a Google Merchant Center product feed (RSS 2.0 + g: namespace)
// from the live Supabase catalog. The SAME feed is accepted by Meta
// Commerce Manager (Advantage+ Shopping catalog), so one endpoint powers
// both Google Performance Max and Meta catalog ads.
//
// Apparel best practice: items with multiple sizes are emitted as one entry
// PER SIZE, sharing an <g:item_group_id> so Google/Meta group them as variants.
// Stock is tracked at the product level here, so every size of an in-stock
// product is marked "in stock" (refine later if you add per-size inventory).
// ============================================================
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const SITE = 'https://homesoil2026.com';
const BRAND = 'Home Soil 2026';

// Map our internal categories to Google product taxonomy IDs.
// https://support.google.com/merchants/answer/6324436
const GOOGLE_CATEGORY = {
  tees:        '212',  // Apparel & Accessories > Clothing > Shirts & Tops
  hoodies:     '5598', // Apparel & Accessories > Clothing > Activewear
  hats:        '179',  // Apparel & Accessories > Clothing Accessories > Hats
  accessories: '167',  // Apparel & Accessories > Clothing Accessories
};

function xmlEscape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// One <item> block. `variantId` differs per size; `groupId` ties sizes together.
function itemXml(p, { variantId, groupId, size, color, available }) {
  const link = `${SITE}/?product=${encodeURIComponent(p.id)}`;
  const desc = p.description && p.description.trim() ? p.description : p.name;
  const lines = [
    `<g:id>${xmlEscape(variantId)}</g:id>`,
    `<g:item_group_id>${xmlEscape(groupId)}</g:item_group_id>`,
    `<g:title>${xmlEscape(p.name)}</g:title>`,
    `<g:description>${xmlEscape(desc)}</g:description>`,
    `<g:link>${xmlEscape(link)}</g:link>`,
    `<g:image_link>${xmlEscape(p.image_url || '')}</g:image_link>`,
    `<g:availability>${available ? 'in_stock' : 'out_of_stock'}</g:availability>`,
    `<g:price>${Number(p.price).toFixed(2)} USD</g:price>`,
    `<g:brand>${xmlEscape(BRAND)}</g:brand>`,
    `<g:condition>new</g:condition>`,
    `<g:identifier_exists>no</g:identifier_exists>`,
    `<g:age_group>adult</g:age_group>`,
    `<g:gender>unisex</g:gender>`,
    `<g:product_type>${xmlEscape(p.category || 'apparel')}</g:product_type>`,
  ];
  const gcat = GOOGLE_CATEGORY[p.category];
  if (gcat) lines.push(`<g:google_product_category>${gcat}</g:google_product_category>`);
  if (size)  lines.push(`<g:size>${xmlEscape(size)}</g:size>`);
  if (color) lines.push(`<g:color>${xmlEscape(color)}</g:color>`);
  return `    <item>\n      ${lines.join('\n      ')}\n    </item>`;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { data, error } = await supabase
      .from('products')
      .select('id, name, price, stock, description, image_url, sizes, category, variant_options')
      .order('created_at', { ascending: true });
    if (error) throw error;

    const items = [];
    for (const p of (data || [])) {
      if (!p.image_url) continue; // Merchant Center rejects items with no image
      const available = Number(p.stock) > 0;
      // First defined colour name (variant_options.colors[].name), if any.
      const color = (p.variant_options && p.variant_options.colors &&
                     p.variant_options.colors[0] && p.variant_options.colors[0].name) || '';
      const sizes = Array.isArray(p.sizes) ? p.sizes.filter(s => s && s !== 'One Size') : [];
      if (sizes.length) {
        // One variant entry per size (apparel best practice).
        for (const size of sizes) {
          const variantId = `${p.id}-${String(size).replace(/\s+/g, '')}`;
          items.push(itemXml(p, { variantId, groupId: p.id, size, color, available }));
        }
      } else {
        // One-size / accessory: single entry, no size attribute.
        items.push(itemXml(p, { variantId: p.id, groupId: p.id, size: '', color, available }));
      }
    }

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>${xmlEscape(BRAND)} — Fan-Inspired USA Soccer Gear</title>
    <link>${SITE}</link>
    <description>Fan-inspired original gear for the 2026 soccer summer. Printed in the USA.</description>
${items.join('\n')}
  </channel>
</rss>`;

    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    // Cache at the edge for 30 min; Google/Meta refetch on their own schedule.
    res.setHeader('Cache-Control', 'public, max-age=1800, s-maxage=1800');
    return res.status(200).send(xml);
  } catch (err) {
    console.error('google-feed error:', err);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
}
