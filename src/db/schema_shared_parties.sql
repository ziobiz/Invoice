-- Shared parties across sites (opt-in per site + flag per party)
ALTER TABLE sites ADD COLUMN IF NOT EXISTS use_shared_parties BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE parties ADD COLUMN IF NOT EXISTS is_shared BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_parties_is_shared ON parties (is_shared) WHERE is_shared = TRUE;
