SELECT invoice_no, ticket_no,
  CASE
    WHEN memo LIKE '[SIMULATOR]%' THEN 'simulator'
    WHEN memo LIKE '[SANDBOX]%' THEN 'sandbox'
    WHEN memo LIKE '[OFFICIAL]%' THEN 'official'
    ELSE 'live'
  END AS kind,
  amount::text, currency, issued_at
FROM invoices i
JOIN sites s ON s.id = i.site_id
WHERE s.code = 'tinpass'
  AND i.deleted_at IS NULL
  AND i.status <> 'void'
ORDER BY i.issued_at DESC
LIMIT 40;
