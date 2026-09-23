-- Per-site invoice auto-purge (NULL = keep forever; 1–30 days)
ALTER TABLE sites ADD COLUMN IF NOT EXISTS invoice_retention_days INT;

COMMENT ON COLUMN sites.invoice_retention_days IS
  'Auto-delete invoices older than N days (1–30). NULL = never purge.';

-- Ensure tinpass-sim site exists (separate from live tinpass)
INSERT INTO sites (code, name, notes, active, invoice_retention_days,
  pdf_simulator_watermark_enabled, pdf_simulator_sample_seal_enabled, pdf_terms_of_payment)
SELECT
  'tinpass-sim',
  'TINPASS Simulator',
  'Simulator channel — separate from live tinpass',
  TRUE,
  3,
  TRUE,
  TRUE,
  'T/T'
WHERE NOT EXISTS (SELECT 1 FROM sites WHERE lower(code) = 'tinpass-sim');

-- Copy active site_mapping from tinpass → tinpass-sim when sim has none
INSERT INTO site_mappings (site_id, seller_party_id, buyer_party_id, product_id, active)
SELECT
  sim.id,
  m.seller_party_id,
  m.buyer_party_id,
  m.product_id,
  TRUE
FROM sites sim
CROSS JOIN LATERAL (
  SELECT m.*
  FROM site_mappings m
  JOIN sites live ON live.id = m.site_id AND lower(live.code) = 'tinpass'
  WHERE m.active = TRUE
  ORDER BY m.created_at DESC NULLS LAST
  LIMIT 1
) m
WHERE lower(sim.code) = 'tinpass-sim'
  AND NOT EXISTS (
    SELECT 1 FROM site_mappings x WHERE x.site_id = sim.id AND x.active = TRUE
  );

-- Align retention default for existing tinpass-sim rows
UPDATE sites SET
  invoice_retention_days = COALESCE(invoice_retention_days, 3)
WHERE lower(code) = 'tinpass-sim';
