/**
 * Public invoice branding: never expose TINPASS on customer-facing
 * filenames / PDF labels. Site API code stays `tinpass` / `tinpass-sim`.
 */

/** Prefix used when allocating new invoice numbers. */
export function invoiceNumberPrefix(siteCode: string): string {
  const c = String(siteCode || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '');
  if (c === 'tinpass') return 'TPDM';
  if (c === 'tinpass-sim' || c === 'tinpasssim') return 'TPDMSIM';
  const raw = String(siteCode || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 12);
  return raw || 'SITE';
}

/**
 * Rewrite stored/legacy invoice numbers for downloads and PDF display.
 * Order matters: TINPASSSIM before TINPASS.
 */
export function toPublicInvoiceNo(invoiceNo: string | null | undefined): string {
  let s = String(invoiceNo || '').trim();
  if (!s) return s;
  s = s.replace(/^TINPASSSIM\b/gi, 'TPDMSIM');
  s = s.replace(/^TINPASS\b/gi, 'TPDM');
  // Safety: strip any remaining TINPASS token from the public label
  s = s.replace(/TINPASS/gi, 'TPDM');
  return s;
}

export function publicInvoicePdfFileName(invoiceNo: string | null | undefined): string {
  const base = toPublicInvoiceNo(invoiceNo) || 'invoice';
  return base.toLowerCase().endsWith('.pdf') ? base : `${base}.pdf`;
}
