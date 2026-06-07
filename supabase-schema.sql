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
  printify_product_id TEXT,                   -- Printify product id (sync key)
  printify_shop_id    TEXT,                   -- which Printify shop it came from
  printify_blueprint_id BIGINT,               -- Printify catalog blueprint
  printify_variants   JSONB DEFAULT '{}',     -- per-size variant map, e.g. {"S":4567,"M":4568}
  printful_product_id BIGINT,                 -- legacy Printful columns (kept for back-compat)
  printful_variant_id BIGINT,
  printful_variants   JSONB DEFAULT '{}',
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
  status             TEXT DEFAULT 'pending',  -- pending | paid | fulfilling | oversold_review | shipped | refunded | partial_refund
  payment_method     TEXT,
  printify_order_id  TEXT,
  printful_order_id  BIGINT,                  -- legacy (kept for back-compat)
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

-- ---------- CHECKOUT RATE LIMIT (PaymentIntent flooding / card-testing) ----------
-- Durable across serverless instances. Caps how often a single client IP can
-- create a PaymentIntent, so a script can't spam Stripe + the orders table or
-- test stolen cards against the endpoint. Generic fixed-window counter keyed by
-- an arbitrary string (we key on "cpi:<ip>").
CREATE TABLE IF NOT EXISTS rate_limits (
  key          TEXT PRIMARY KEY,
  count        INTEGER NOT NULL DEFAULT 0,
  window_start TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;  -- service-role only

-- Atomic fixed-window check: allows at most p_max requests per p_window_seconds
-- for a given key. Returns TRUE when the request is allowed, FALSE when it's
-- over the cap. Locks the key row (FOR UPDATE) so concurrent serverless calls
-- can't both slip past the limit.
CREATE OR REPLACE FUNCTION check_rate_limit(p_key TEXT, p_max INTEGER, p_window_seconds INTEGER)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE
  v_count INTEGER;
  v_start TIMESTAMPTZ;
BEGIN
  -- Ensure a row exists, then lock it so concurrent requests serialize.
  INSERT INTO rate_limits (key) VALUES (p_key) ON CONFLICT (key) DO NOTHING;
  SELECT count, window_start INTO v_count, v_start
    FROM rate_limits WHERE key = p_key FOR UPDATE;

  -- Window expired → start a fresh window and allow.
  IF NOW() - v_start >= make_interval(secs => p_window_seconds) THEN
    UPDATE rate_limits SET count = 1, window_start = NOW() WHERE key = p_key;
    RETURN TRUE;
  END IF;

  -- Within the window and under the cap → count this request and allow.
  IF v_count < p_max THEN
    UPDATE rate_limits SET count = count + 1 WHERE key = p_key;
    RETURN TRUE;
  END IF;

  -- Over the cap → block.
  RETURN FALSE;
END;
$$;
-- Optional housekeeping: stale keys just sit at their last window. To keep the
-- table tiny you can periodically prune them, e.g.
--   DELETE FROM rate_limits WHERE window_start < NOW() - INTERVAL '1 day';

-- ---------- MIGRATIONS (safe to re-run on an existing database) ----------
-- If you created the tables before these columns existed, run this once.
ALTER TABLE products ADD COLUMN IF NOT EXISTS printful_variants JSONB DEFAULT '{}';
-- Printify migration:
ALTER TABLE products ADD COLUMN IF NOT EXISTS printify_product_id   TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS printify_shop_id      TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS printify_blueprint_id BIGINT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS printify_variants     JSONB DEFAULT '{}';
ALTER TABLE orders   ADD COLUMN IF NOT EXISTS printify_order_id     TEXT;
-- Look up products fast by their Printify id (used by the delete webhook).
CREATE INDEX IF NOT EXISTS idx_products_printify_product_id ON products (printify_product_id);

-- ---------- SEED: load the 10 launch products ----------
-- (Optional) Copy your PRODUCTS array values here, or insert via the admin later.
-- Example:
-- INSERT INTO products (id,name,price,stock,description,image_url,sizes,category) VALUES
-- ('hs-tee-001','Home Soil Premium Tee',34,42,'Heavyweight cotton tee','https://...',ARRAY['S','M','L','XL'],'tees');
