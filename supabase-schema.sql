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
  printful_variant_id BIGINT,                 -- legacy single-variant id (kept for back-compat)
  printful_variants   JSONB DEFAULT '{}',     -- per-size sync-variant map, e.g. {"S":4567,"M":4568}
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
  status             TEXT DEFAULT 'pending',  -- pending | paid | oversold_review | shipped | refunded
  payment_method     TEXT,
  printful_order_id  BIGINT,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
-- No public policies: orders are accessible only via the service role (backend). Customers never read orders directly.

-- ---------- DESIGNS (optional: track artwork from your external design system) ----------
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
-- Atomic + conditional: only decrements when there is enough stock, so two
-- concurrent orders for the last unit can't both succeed. Returns the remaining
-- stock, or -1 when there wasn't enough (the webhook flags those orders for
-- review instead of letting stock go negative).
-- DROP first: this function's return type changed (void -> integer), and
-- Postgres won't let CREATE OR REPLACE change a return type.
DROP FUNCTION IF EXISTS decrement_stock(TEXT, INTEGER);
CREATE OR REPLACE FUNCTION decrement_stock(p_id TEXT, p_qty INTEGER)
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE remaining INTEGER;
BEGIN
  UPDATE products SET stock = stock - p_qty
    WHERE id = p_id AND stock >= p_qty
    RETURNING stock INTO remaining;
  IF NOT FOUND THEN
    RETURN -1;
  END IF;
  RETURN remaining;
END;
$$;

-- ---------- ADMIN AUTH THROTTLE (brute-force protection) ----------
-- Durable across serverless instances. The admin endpoints record failed
-- password attempts per client IP and lock the IP after too many.
CREATE TABLE IF NOT EXISTS auth_throttle (
  ip           TEXT PRIMARY KEY,
  fails        INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE auth_throttle ENABLE ROW LEVEL SECURITY;  -- service-role only

-- ---------- MIGRATIONS (safe to re-run on an existing database) ----------
-- If you created the tables before these columns existed, run this once.
ALTER TABLE products ADD COLUMN IF NOT EXISTS printful_variants JSONB DEFAULT '{}';

-- ---------- SEED: load the 10 launch products ----------
-- (Optional) Copy your PRODUCTS array values here, or insert via the admin later.
-- Example:
-- INSERT INTO products (id,name,price,stock,description,image_url,sizes,category) VALUES
-- ('hs-tee-001','Home Soil Premium Tee',34,42,'Heavyweight cotton tee','https://...',ARRAY['S','M','L','XL'],'tees');
