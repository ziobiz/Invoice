-- Preview/download used to stamp pdf_regenerated_at on every PDF open.
-- Keep the timestamp only when an explicit "재생성" audit exists.
UPDATE invoices i
SET pdf_regenerated_at = NULL
WHERE pdf_regenerated_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM audit_logs a
    WHERE a.invoice_id = i.id
      AND a.event_type = 'invoice.pdf.regenerated'
  );
