-- Public authenticity verify token (QR on PDF)
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS verify_token TEXT;

UPDATE invoices
SET verify_token = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
WHERE verify_token IS NULL OR TRIM(verify_token) = '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_verify_token ON invoices (verify_token);
