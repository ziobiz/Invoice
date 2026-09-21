-- Per-site line-item text presets (A/B/C) for PDF Item / Description / Unit label
-- Slot off = use original product/line values

ALTER TABLE sites ADD COLUMN IF NOT EXISTS pdf_line_slot TEXT NOT NULL DEFAULT 'off';

ALTER TABLE sites ADD COLUMN IF NOT EXISTS pdf_line_a_name TEXT NOT NULL DEFAULT 'Active A';
ALTER TABLE sites ADD COLUMN IF NOT EXISTS pdf_line_a_item TEXT;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS pdf_line_a_description TEXT;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS pdf_line_a_unit_label TEXT;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS pdf_line_a_hide_unit_price BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE sites ADD COLUMN IF NOT EXISTS pdf_line_b_name TEXT NOT NULL DEFAULT 'Active B';
ALTER TABLE sites ADD COLUMN IF NOT EXISTS pdf_line_b_item TEXT;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS pdf_line_b_description TEXT;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS pdf_line_b_unit_label TEXT;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS pdf_line_b_hide_unit_price BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE sites ADD COLUMN IF NOT EXISTS pdf_line_c_name TEXT NOT NULL DEFAULT 'Active C';
ALTER TABLE sites ADD COLUMN IF NOT EXISTS pdf_line_c_item TEXT;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS pdf_line_c_description TEXT;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS pdf_line_c_unit_label TEXT;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS pdf_line_c_hide_unit_price BOOLEAN NOT NULL DEFAULT FALSE;

-- Sensible starter texts (only when empty)
UPDATE sites SET
  pdf_line_a_item = COALESCE(NULLIF(TRIM(pdf_line_a_item), ''), 'USDT Purchase'),
  pdf_line_a_description = COALESCE(NULLIF(TRIM(pdf_line_a_description), ''), 'Virtual asset (USDT) purchase settlement'),
  pdf_line_a_unit_label = COALESCE(pdf_line_a_unit_label, 'USDT'),
  pdf_line_b_item = COALESCE(NULLIF(TRIM(pdf_line_b_item), ''), 'Asset Purchase'),
  pdf_line_b_description = COALESCE(NULLIF(TRIM(pdf_line_b_description), ''), 'Virtual asset purchase settlement'),
  pdf_line_c_item = COALESCE(NULLIF(TRIM(pdf_line_c_item), ''), 'Settlement'),
  pdf_line_c_description = COALESCE(NULLIF(TRIM(pdf_line_c_description), ''), 'Payment settlement')
WHERE TRUE;
