-- ============================================================
-- Home Soil 2026 — Supabase schema
-- Run this in Supabase → SQL Editor → New query → Run.
-- ============================================================

-- ---------- PRODUCTS ----------
CREATE TABLE IF NOT EXISTS products (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  price               NUMERIC(10,2) NOT NULL,
  stock               INTEGER NOT NULL DEFAULT 0,
  description         TEXT,
  image_url           TEXT,
  sizes               TEXT[],
  category            TEXT,
  printful_product_id BIGINT,
  printful_variant_id BIGINT,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE products ENABLE ROW LEVEL SECURITY;
-- Anyone can read the catalog
CREATE POLICY "public read products" ON products FOR SELECT USING (true);
-- Only the service role (your backend) writes. No public write policy = locked down.

-- ---------- ORDERS ----------
CREATE TABLE IF NOT EXISTS orders (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email              TEXT NOT NULL,
  customer           JSONB,
  items              JSONB NOT NULL,
  subtotal           NUMERIC(10,2),
  shipping           NUMERIC(10,2),
  tax                NUMERIC(10,2),
  total              NUMERIC(10,2),
  status             TEXT DEFAULT 'pending',  -- pending | paid | fulfilling | needs_manual_fulfillment | shipped
  payment_method     TEXT,
  printful_order_id  BIGINT,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
-- No public policies: orders are accessible only via the service role (backend). Customers never read orders directly.

-- ---------- DESIGNS (Grok AI Design Studio) ----------
CREATE TABLE IF NOT EXISTS designs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt      TEXT NOT NULL,
  garment     TEXT,
  image_url   TEXT,
  status      TEXT DEFAULT 'draft',  -- draft | published
  product_id  TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE designs ENABLE ROW LEVEL SECURITY;
-- service-role only.

-- ---------- STOCK DECREMENT (called by the Stripe webhook) ----------
CREATE OR REPLACE FUNCTION decrement_stock(p_id TEXT, p_qty INTEGER)
RETURNS void LANGUAGE sql AS $$
  UPDATE products SET stock = GREATEST(stock - p_qty, 0) WHERE id = p_id;
$$;

-- ---------- SEED: load the 10 launch products ----------
-- (Optional) Copy your PRODUCTS array values here, or insert via the admin later.
-- Example:
-- INSERT INTO products (id,name,price,stock,description,image_url,sizes,category) VALUES
-- ('hs-tee-001','Home Soil Premium Tee',34,42,'Heavyweight cotton tee','https://...',ARRAY['S','M','L','XL'],'tees');
