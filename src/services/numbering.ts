import type { PoolClient } from 'pg';

/**
 * Invoice number assumption (documented in README):
 *   {SITECODE}-{YYYY}-{NNNNNN}
 * Example: TINPASS-2026-000001
 * Sequence is per site + calendar year (Asia/Seoul unless overridden by DB NOW() year).
 */
export async function nextInvoiceNo(
  client: PoolClient,
  siteId: string,
  siteCode: string,
  year: number,
): Promise<string> {
  const upsert = await client.query<{ last_seq: number }>(
    `INSERT INTO invoice_sequences (site_id, year, last_seq)
     VALUES ($1, $2, 1)
     ON CONFLICT (site_id, year)
     DO UPDATE SET last_seq = invoice_sequences.last_seq + 1
     RETURNING last_seq`,
    [siteId, year],
  );
  const seq = upsert.rows[0].last_seq;
  const code = siteCode.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12) || 'SITE';
  return `${code}-${year}-${String(seq).padStart(6, '0')}`;
}

/**
 * Merged invoice number: {SITECODE}-M-{YYYY}-{NNNNNN}
 * Example: TINPASS-M-2026-000001
 */
export async function nextMergedInvoiceNo(
  client: PoolClient,
  siteId: string,
  siteCode: string,
  year: number,
): Promise<string> {
  const upsert = await client.query<{ last_seq: number }>(
    `INSERT INTO merged_invoice_sequences (site_id, year, last_seq)
     VALUES ($1, $2, 1)
     ON CONFLICT (site_id, year)
     DO UPDATE SET last_seq = merged_invoice_sequences.last_seq + 1
     RETURNING last_seq`,
    [siteId, year],
  );
  const seq = upsert.rows[0].last_seq;
  const code = siteCode.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12) || 'SITE';
  return `${code}-M-${year}-${String(seq).padStart(6, '0')}`;
}

/** Revision of a merged invoice: {rootNo}-R{NN} */
export function mergedRevisionInvoiceNo(rootNo: string, revisionNo: number): string {
  const n = Math.max(2, revisionNo);
  return `${rootNo}-R${String(n).padStart(2, '0')}`;
}
