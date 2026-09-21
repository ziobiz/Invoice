-- Backfill last_actor_id on reissued invoices from audit log
UPDATE invoices i
SET last_actor_id = a.actor_id::uuid
FROM (
  SELECT DISTINCT ON (invoice_id) invoice_id, actor_id
  FROM audit_logs
  WHERE event_type = 'invoice.reissued'
    AND actor_type = 'admin'
    AND actor_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND invoice_id IS NOT NULL
  ORDER BY invoice_id, created_at DESC
) a
WHERE i.id = a.invoice_id
  AND i.last_actor_id IS NULL
  AND (i.created_by = 'admin' OR i.reissued_from_id IS NOT NULL OR i.status = 'reissued');
