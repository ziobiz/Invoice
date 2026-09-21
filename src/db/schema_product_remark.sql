-- Default Remark text shown on invoice line items (PDF Remark column)
ALTER TABLE products ADD COLUMN IF NOT EXISTS remark TEXT;
