-- Allow created_by = 'api' for webhook-issued invoices
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_created_by_check;
ALTER TABLE invoices
  ADD CONSTRAINT invoices_created_by_check
  CHECK (created_by IN ('system', 'admin', 'api'));

-- Existing webhook issues were stored as 'system' — show as API
UPDATE invoices SET created_by = 'api' WHERE created_by = 'system';
