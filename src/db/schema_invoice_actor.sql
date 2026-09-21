-- Invoice last actor / soft-delete + admin display alias

ALTER TABLE admins ADD COLUMN IF NOT EXISTS alias TEXT;

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS last_actor_id UUID REFERENCES admins(id) ON DELETE SET NULL;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_invoices_deleted_at ON invoices(deleted_at);
CREATE INDEX IF NOT EXISTS idx_invoices_last_actor ON invoices(last_actor_id);
