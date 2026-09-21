-- Notice bank detail fields (PDF title is always "Notice"; slot name is admin-only)
-- Per active slot a/b/c

ALTER TABLE sites ADD COLUMN IF NOT EXISTS pdf_notice_a_bank_name TEXT;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS pdf_notice_a_address TEXT;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS pdf_notice_a_bank_code TEXT;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS pdf_notice_a_branch_code TEXT;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS pdf_notice_a_account_type TEXT;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS pdf_notice_a_account_number TEXT;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS pdf_notice_a_account_holder TEXT;

ALTER TABLE sites ADD COLUMN IF NOT EXISTS pdf_notice_b_bank_name TEXT;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS pdf_notice_b_address TEXT;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS pdf_notice_b_bank_code TEXT;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS pdf_notice_b_branch_code TEXT;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS pdf_notice_b_account_type TEXT;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS pdf_notice_b_account_number TEXT;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS pdf_notice_b_account_holder TEXT;

ALTER TABLE sites ADD COLUMN IF NOT EXISTS pdf_notice_c_bank_name TEXT;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS pdf_notice_c_address TEXT;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS pdf_notice_c_bank_code TEXT;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS pdf_notice_c_branch_code TEXT;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS pdf_notice_c_account_type TEXT;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS pdf_notice_c_account_number TEXT;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS pdf_notice_c_account_holder TEXT;

-- Migrate legacy A/C fields into new columns when empty
UPDATE sites SET
  pdf_notice_a_account_number = COALESCE(NULLIF(TRIM(pdf_notice_a_account_number), ''), NULLIF(TRIM(pdf_notice_a_ac_no), ''), NULLIF(TRIM(pdf_notice_ac_no), '')),
  pdf_notice_a_account_holder = COALESCE(NULLIF(TRIM(pdf_notice_a_account_holder), ''), NULLIF(TRIM(pdf_notice_a_ac_name), ''), NULLIF(TRIM(pdf_notice_ac_name), '')),
  pdf_notice_a_address = COALESCE(NULLIF(TRIM(pdf_notice_a_address), ''), NULLIF(TRIM(pdf_notice_a_bank_add), ''), NULLIF(TRIM(pdf_notice_bank_add), '')),
  pdf_notice_b_account_number = COALESCE(NULLIF(TRIM(pdf_notice_b_account_number), ''), NULLIF(TRIM(pdf_notice_b_ac_no), '')),
  pdf_notice_b_account_holder = COALESCE(NULLIF(TRIM(pdf_notice_b_account_holder), ''), NULLIF(TRIM(pdf_notice_b_ac_name), '')),
  pdf_notice_b_address = COALESCE(NULLIF(TRIM(pdf_notice_b_address), ''), NULLIF(TRIM(pdf_notice_b_bank_add), '')),
  pdf_notice_c_account_number = COALESCE(NULLIF(TRIM(pdf_notice_c_account_number), ''), NULLIF(TRIM(pdf_notice_c_ac_no), '')),
  pdf_notice_c_account_holder = COALESCE(NULLIF(TRIM(pdf_notice_c_account_holder), ''), NULLIF(TRIM(pdf_notice_c_ac_name), '')),
  pdf_notice_c_address = COALESCE(NULLIF(TRIM(pdf_notice_c_address), ''), NULLIF(TRIM(pdf_notice_c_bank_add), ''))
WHERE TRUE;
