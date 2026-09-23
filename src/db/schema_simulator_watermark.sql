-- Simulator PDF watermark (test disclaimer) — per-site enable + optional custom text
ALTER TABLE sites ADD COLUMN IF NOT EXISTS pdf_simulator_watermark_enabled BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS pdf_simulator_watermark_text TEXT;
