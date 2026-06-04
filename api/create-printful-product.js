// ============================================================
// POST /api/create-printful-product
// Step 2 of the Design Studio: takes a generated design and creates a real
// Printful product, then saves it to your store's products table so it goes live.
// ============================================================
import { createClient } from '@supabase/supabase-js';
import { createPrintfulProduct } from './_lib/printful.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Map your friendly garment names to Printful catalog variant IDs (sizes).
// Look these up once in the Printful catalog and fill in real IDs.
const GARMENT_VARIANTS = {
  'Premium Tee':   { variantIds: [4012, 4013, 4014, 4015, 4016], price: 34, category: 'tees' },     // S–2XL example
  'Fleece Hoodie': { variantIds: [5530, 5531, 5532, 5533, 5534], price: 64, category: 'hoodies' },
  'Snapback Hat':  { variantIds: [7854], price: 28, category: 'hats' },
  'Dad Hat':       { variantIds: [7857], price: 24, category: 'hats' }
};

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { designId } = req.body || {};
    const { data: design, error: dErr } = await supabase
      .from('designs').select('*').eq('id', designId).single();
    if (dErr || !design) return res.status(404).json({ error: 'Design not found' });

    const g = GARMENT_VARIANTS[design.garment];
    if (!g) return res.status(400).json({ error: `No variant map for garment: ${design.garment}` });

    // Create the product in Printful
    const pf = await createPrintfulProduct({
      name: `Home Soil 2026 — ${design.garment}`,
      imageUrl: design.image_url,
      blueprintVariantIds: g.variantIds,
      retailPrice: g.price
    });

    // Save to your store so it appears on the site
    const newId = 'hs-ai-' + Date.now();
    await supabase.from('products').insert({
      id: newId,
      name: `Home Soil 2026 — ${design.garment}`,
      price: g.price,
      stock: 100,
      description: `AI-designed original artwork: "${design.prompt}". Fan-inspired, printed in the USA.`,
      image_url: pf.sync_product?.thumbnail_url || design.image_url,
      sizes: ['S', 'M', 'L', 'XL', '2XL'],
      category: g.category,
      printful_product_id: pf.sync_product?.id
    });

    await supabase.from('designs').update({ status: 'published', product_id: newId }).eq('id', designId);

    return res.status(200).json({ ok: true, productId: newId, printfulProductId: pf.sync_product?.id });
  } catch (err) {
    console.error('create-printful-product error:', err);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
}
