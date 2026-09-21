-- Per-site defaults for Payment / Remarks / Notice blocks on invoice PDFs
ALTER TABLE sites ADD COLUMN IF NOT EXISTS pdf_payment_date_offset INT NOT NULL DEFAULT 3;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS pdf_payment_terms TEXT;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS pdf_payment_due TEXT;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS pdf_remarks_notice TEXT;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS pdf_remarks_enabled BOOLEAN NOT NULL DEFAULT TRUE;

-- Legacy single notice (kept for migration)
ALTER TABLE sites ADD COLUMN IF NOT EXISTS pdf_notice_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS pdf_notice_text TEXT;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS pdf_notice_ac_no TEXT;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS pdf_notice_ac_name TEXT;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS pdf_notice_bank_add TEXT;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS pdf_notice_swift TEXT;

-- Notice slot: off | a | b | c
ALTER TABLE sites ADD COLUMN IF NOT EXISTS pdf_notice_slot TEXT NOT NULL DEFAULT 'off';

ALTER TABLE sites ADD COLUMN IF NOT EXISTS pdf_notice_a_name TEXT NOT NULL DEFAULT 'Active A';
ALTER TABLE sites ADD COLUMN IF NOT EXISTS pdf_notice_a_text TEXT;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS pdf_notice_a_ac_no TEXT;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS pdf_notice_a_ac_name TEXT;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS pdf_notice_a_bank_add TEXT;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS pdf_notice_a_swift TEXT;

ALTER TABLE sites ADD COLUMN IF NOT EXISTS pdf_notice_b_name TEXT NOT NULL DEFAULT 'Active B';
ALTER TABLE sites ADD COLUMN IF NOT EXISTS pdf_notice_b_text TEXT;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS pdf_notice_b_ac_no TEXT;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS pdf_notice_b_ac_name TEXT;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS pdf_notice_b_bank_add TEXT;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS pdf_notice_b_swift TEXT;

ALTER TABLE sites ADD COLUMN IF NOT EXISTS pdf_notice_c_name TEXT NOT NULL DEFAULT 'Active C';
ALTER TABLE sites ADD COLUMN IF NOT EXISTS pdf_notice_c_text TEXT;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS pdf_notice_c_ac_no TEXT;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS pdf_notice_c_ac_name TEXT;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS pdf_notice_c_bank_add TEXT;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS pdf_notice_c_swift TEXT;

-- Seed currently shown PDF defaults for existing sites (EN bank form)
UPDATE sites SET
  pdf_payment_terms = COALESCE(
    NULLIF(TRIM(pdf_payment_terms), ''),
    'The above TOTAL amount must be deposited in full (The remittance fee is to be paid by the remitter)'
  ),
  pdf_payment_due = COALESCE(
    NULLIF(TRIM(pdf_payment_due), ''),
    'Please deposit by the due date'
  ),
  pdf_notice_text = COALESCE(
    NULLIF(TRIM(pdf_notice_text), ''),
    'Notice: This invoice is electronically generated and is valid without a physical signature or company seal.'
  )
WHERE TRUE;

-- Migrate legacy single notice → slot A
UPDATE sites SET
  pdf_notice_slot = CASE
    WHEN pdf_notice_slot IS NOT NULL AND pdf_notice_slot <> 'off' THEN pdf_notice_slot
    WHEN pdf_notice_enabled = TRUE THEN 'a'
    ELSE 'off'
  END,
  pdf_notice_a_text = COALESCE(NULLIF(TRIM(pdf_notice_a_text), ''), pdf_notice_text),
  pdf_notice_a_ac_no = COALESCE(NULLIF(TRIM(pdf_notice_a_ac_no), ''), pdf_notice_ac_no),
  pdf_notice_a_ac_name = COALESCE(NULLIF(TRIM(pdf_notice_a_ac_name), ''), pdf_notice_ac_name),
  pdf_notice_a_bank_add = COALESCE(NULLIF(TRIM(pdf_notice_a_bank_add), ''), pdf_notice_bank_add),
  pdf_notice_a_swift = COALESCE(NULLIF(TRIM(pdf_notice_a_swift), ''), pdf_notice_swift),
  pdf_notice_b_text = COALESCE(
    NULLIF(TRIM(pdf_notice_b_text), ''),
    'Notice: This invoice is electronically generated and is valid without a physical signature or company seal.'
  ),
  pdf_notice_c_text = COALESCE(
    NULLIF(TRIM(pdf_notice_c_text), ''),
    'Notice: This invoice is electronically generated and is valid without a physical signature or company seal.'
  )
WHERE TRUE;
