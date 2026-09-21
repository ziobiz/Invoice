-- Party-level contact / signatory (buyer Messrs + seller PDF signature)
-- Site signatory_* remains as fallback when party fields are empty.
ALTER TABLE parties ADD COLUMN IF NOT EXISTS signatory_name TEXT;
ALTER TABLE parties ADD COLUMN IF NOT EXISTS signatory_title TEXT;
