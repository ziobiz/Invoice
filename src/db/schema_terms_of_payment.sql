-- Site-editable "Terms of Payment : …" line on invoice PDF header
ALTER TABLE sites ADD COLUMN IF NOT EXISTS pdf_terms_of_payment TEXT;

-- Prefer T/T when empty (locale default also T/T)
UPDATE sites SET
  pdf_terms_of_payment = COALESCE(NULLIF(TRIM(pdf_terms_of_payment), ''), 'T/T')
WHERE TRUE;
