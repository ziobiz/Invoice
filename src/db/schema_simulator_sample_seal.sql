-- Simulator SAMPLE seal toggle (independent of watermark; defaults linked in UI)
ALTER TABLE sites ADD COLUMN IF NOT EXISTS pdf_simulator_sample_seal_enabled BOOLEAN NOT NULL DEFAULT TRUE;

-- Align with watermark default (both on for simulator “test mode”)
UPDATE sites SET
  pdf_simulator_sample_seal_enabled = COALESCE(pdf_simulator_watermark_enabled, TRUE)
WHERE TRUE;
