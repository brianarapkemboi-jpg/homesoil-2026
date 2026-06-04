// ============================================================
// GET /api/products
// Returns the live catalog from Supabase. The front-end can fetch this on load
// to replace the hardcoded PRODUCTS array once you've migrated to the database.
// ============================================================
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { data, error } = await supabase
      .from('products').select('*').order('created_at', { ascending: true });
    if (error) throw error;
    return res.status(200).json({ products: data });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
