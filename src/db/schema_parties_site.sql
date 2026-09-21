-- Parties scoped per connected site + invoice touch tracking
ALTER TABLE parties ADD COLUMN IF NOT EXISTS site_id UUID REFERENCES sites(id) ON DELETE CASCADE;
ALTER TABLE parties ADD COLUMN IF NOT EXISTS website TEXT;

ALTER TABLE parties DROP CONSTRAINT IF EXISTS parties_code_key;
DROP INDEX IF EXISTS parties_code_key;

-- Attach orphan parties to tinpass (or first site) when possible
UPDATE parties p
SET site_id = coalesce(
  (SELECT id FROM sites WHERE lower(code) = 'tinpass' LIMIT 1),
  (SELECT id FROM sites ORDER BY created_at ASC LIMIT 1)
)
WHERE p.site_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_parties_site_code ON parties (site_id, code);

CREATE INDEX IF NOT EXISTS idx_parties_site ON parties (site_id);

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS pdf_regenerated_at TIMESTAMPTZ;
