-- Invoice Service schema (MVP)
-- Assumptions documented in README

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS admins (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'hq' CHECK (role IN ('hq', 'viewer')),
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sites (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code          TEXT NOT NULL UNIQUE,          -- e.g. tinpass, dealmai
  name          TEXT NOT NULL,
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS api_keys (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id       UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  label         TEXT NOT NULL DEFAULT 'default',
  key_prefix    TEXT NOT NULL,                 -- first 8 chars for display
  key_hash      TEXT NOT NULL,                 -- sha256 of full key
  secret_hash   TEXT NOT NULL,                 -- sha256 of HMAC secret (we also store encrypted/plain secret for HMAC verify — see note)
  hmac_secret   TEXT NOT NULL,                 -- HMAC secret (server-side only; rotate with key)
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  last_used_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys(key_prefix);
CREATE INDEX IF NOT EXISTS idx_api_keys_site ON api_keys(site_id);

CREATE TABLE IF NOT EXISTS parties (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code          TEXT NOT NULL UNIQUE,          -- seller/buyer entity code
  kind          TEXT NOT NULL CHECK (kind IN ('seller', 'buyer', 'both')),
  legal_name    TEXT NOT NULL,
  trade_name    TEXT,
  country       TEXT,
  address       TEXT,
  tax_id        TEXT,
  email         TEXT,
  phone         TEXT,
  bank_info     TEXT,
  signatory_name  TEXT,   -- buyer contact / seller signatory
  signatory_title TEXT,
  extra_json    JSONB NOT NULL DEFAULT '{}'::jsonb,
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS products (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code          TEXT NOT NULL UNIQUE,          -- product catalog code
  name          TEXT NOT NULL,
  description   TEXT,
  unit          TEXT NOT NULL DEFAULT 'EA',
  default_currency TEXT NOT NULL DEFAULT 'USD',
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS site_mappings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id         UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  seller_party_id UUID NOT NULL REFERENCES parties(id),
  buyer_party_id  UUID NOT NULL REFERENCES parties(id),
  product_id      UUID NOT NULL REFERENCES products(id),
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (site_id)
);

CREATE TABLE IF NOT EXISTS invoices (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_no            TEXT NOT NULL UNIQUE,
  status                TEXT NOT NULL DEFAULT 'issued'
                          CHECK (status IN ('issued', 'void', 'reissued')),
  site_id               UUID NOT NULL REFERENCES sites(id),
  source_transaction_id TEXT NOT NULL,
  ticket_no             TEXT,
  idempotency_key       TEXT NOT NULL,
  issued_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  currency              TEXT NOT NULL,
  amount                NUMERIC(24, 8) NOT NULL,
  asset                 TEXT,
  asset_amount          NUMERIC(24, 8),
  buyer_ref             TEXT,
  memo                  TEXT,
  seller_snapshot       JSONB NOT NULL,
  buyer_snapshot        JSONB NOT NULL,
  product_snapshot      JSONB NOT NULL,
  pdf_path              TEXT,
  pdf_hash              TEXT,
  created_by            TEXT NOT NULL DEFAULT 'system'
                          CHECK (created_by IN ('system', 'admin', 'api')),
  reissued_from_id      UUID REFERENCES invoices(id),
  raw_payload           JSONB,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (site_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_invoices_site ON invoices(site_id);
CREATE INDEX IF NOT EXISTS idx_invoices_tx ON invoices(site_id, source_transaction_id);
CREATE INDEX IF NOT EXISTS idx_invoices_issued ON invoices(issued_at DESC);

CREATE TABLE IF NOT EXISTS invoice_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id    UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  line_no       INT NOT NULL,
  product_code  TEXT NOT NULL,
  description   TEXT NOT NULL,
  quantity      NUMERIC(24, 8) NOT NULL DEFAULT 1,
  unit          TEXT NOT NULL DEFAULT 'EA',
  unit_price    NUMERIC(24, 8) NOT NULL,
  amount        NUMERIC(24, 8) NOT NULL,
  currency      TEXT NOT NULL,
  meta_json     JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS invoice_sequences (
  site_id       UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  year          INT NOT NULL,
  last_seq      INT NOT NULL DEFAULT 0,
  PRIMARY KEY (site_id, year)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type    TEXT NOT NULL,                 -- invoice.issued, invoice.reissued, invoice.download, admin.login, ...
  actor_type    TEXT NOT NULL,                 -- system, admin, site
  actor_id      TEXT,
  site_id       UUID REFERENCES sites(id),
  invoice_id    UUID REFERENCES invoices(id),
  detail_json   JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip            TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_invoice ON audit_logs(invoice_id);
