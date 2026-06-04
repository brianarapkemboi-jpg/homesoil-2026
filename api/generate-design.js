// ============================================================
// POST /api/generate-design
// Owner-only: takes a text description, generates ORIGINAL artwork with
// xAI Grok image generation, stores it, and returns a preview.
// A second step (/api/create-printful-product) turns it into a real product.
//
// IMPORTANT — legal: we hard-append guardrails to keep designs original and
// avoid protected marks (FIFA, U.S. Soccer, official emblems, trophy likeness).
// ============================================================
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const XAI_API = 'https://api.x.ai/v1/images/generations';

// Guardrails appended to every prompt to keep output original + print-friendly.
const STYLE_GUARD =
  ' . Original fan-art style, bold vector-friendly graphic suitable for screen printing on apparel,' +
  ' high contrast, centered composition on a transparent or plain background, red white and navy palette,' +
  ' modern athletic aesthetic. Do NOT include any real logos, official emblems, trademarks, FIFA or' +
  ' U.S. Soccer marks, trophy likenesses, country flags as official insignia, player likenesses, or copyrighted text.';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { prompt, garment } = req.body || {};
    if (!prompt || prompt.trim().length < 5) {
      return res.status(400).json({ error: 'Please provide a longer design description' });
    }

    // --- Call Grok image generation (xAI) ---
    const aiRes = await fetch(XAI_API, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.XAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'grok-2-image-1212',
        prompt: prompt.trim() + STYLE_GUARD,
        n: 1,
        response_format: 'url'
      })
    });
    const aiData = await aiRes.json();
    if (!aiRes.ok) throw new Error(aiData.error?.message || aiData.error || 'Grok generation failed');

    const rawImageUrl = aiData.data?.[0]?.url;
    if (!rawImageUrl) throw new Error('No image returned from Grok');

    // NOTE: Grok output is ~1024px. For production print quality you should run an
    // upscale + background-removal step here (e.g. an upscaler API) before Printful.
    // We store the raw URL now and the create-printful-product step uses the print file.

    // --- Save the draft design ---
    const { data: design, error } = await supabase
      .from('designs').insert({
        prompt: prompt.trim(),
        garment,
        image_url: rawImageUrl,
        status: 'draft'
      }).select().single();
    if (error) throw new Error('Could not save design');

    return res.status(200).json({
      designId: design.id,
      imageUrl: rawImageUrl,
      garment
    });
  } catch (err) {
    console.error('generate-design error:', err);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
}
