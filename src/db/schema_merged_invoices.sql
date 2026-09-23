-- Merged (consolidated) invoices — separate from regular invoices numbering & tables

CREATE TABLE IF NOT EXISTS merged_invoice_sequences (
  site_id   UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  year      INT NOT NULL,
  last_seq  INT NOT NULL DEFAULT 0,
  PRIMARY KEY (site_id, year)
);

CREATE TABLE IF NOT EXISTS merged_invoices (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_no         TEXT NOT NULL UNIQUE,
  site_id            UUID NOT NULL REFERENCES sites(id),
  issued_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  currency           TEXT NOT NULL,
  amount             NUMERIC(24, 8) NOT NULL,
  mode               TEXT NOT NULL DEFAULT 'lines'
                       CHECK (mode IN ('lines', 'total')),
  seller_snapshot    JSONB NOT NULL,
  buyer_snapshot     JSONB NOT NULL,
  product_snapshot   JSONB NOT NULL DEFAULT '{}'::jsonb,
  memo               TEXT,
  ticket_no          TEXT,
  asset              TEXT,
  asset_amount       NUMERIC(24, 8),
  buyer_ref          TEXT,
  pdf_path           TEXT,
  pdf_hash           TEXT,
  root_id            UUID NOT NULL, -- points to original; original uses own id (set after insert)
  revision_no        INT NOT NULL DEFAULT 1,
  revised_from_id    UUID REFERENCES merged_invoices(id),
  deleted_at         TIMESTAMPTZ,
  created_by         TEXT NOT NULL DEFAULT 'admin',
  last_actor_id      UUID REFERENCES admins(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_merged_invoices_site ON merged_invoices(site_id);
CREATE INDEX IF NOT EXISTS idx_merged_invoices_issued ON merged_invoices(issued_at DESC);
CREATE INDEX IF NOT EXISTS idx_merged_invoices_root ON merged_invoices(root_id);
CREATE INDEX IF NOT EXISTS idx_merged_invoices_deleted ON merged_invoices(deleted_at);

CREATE TABLE IF NOT EXISTS merged_invoice_sources (
  merged_id          UUID NOT NULL REFERENCES merged_invoices(id) ON DELETE CASCADE,
  source_invoice_id  UUID NOT NULL REFERENCES invoices(id),
  PRIMARY KEY (merged_id, source_invoice_id)
);

CREATE INDEX IF NOT EXISTS idx_merged_sources_source ON merged_invoice_sources(source_invoice_id);

CREATE TABLE IF NOT EXISTS merged_invoice_items (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merged_id          UUID NOT NULL REFERENCES merged_invoices(id) ON DELETE CASCADE,
  line_no            INT NOT NULL,
  product_code       TEXT NOT NULL DEFAULT '',
  description        TEXT NOT NULL,
  quantity           NUMERIC(24, 8) NOT NULL DEFAULT 1,
  unit               TEXT NOT NULL DEFAULT 'EA',
  unit_price         NUMERIC(24, 8) NOT NULL,
  amount             NUMERIC(24, 8) NOT NULL,
  currency           TEXT NOT NULL,
  source_invoice_id  UUID REFERENCES invoices(id),
  item_name          TEXT,
  remark             TEXT,
  UNIQUE (merged_id, line_no)
);
