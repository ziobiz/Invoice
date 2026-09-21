-- Distinguish content edit vs PDF-only regenerate for status display
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS content_edited_at TIMESTAMPTZ;
