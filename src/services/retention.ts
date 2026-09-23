import fs from 'node:fs';
import { query } from '../db/pool.js';
import { writeAudit } from './crypto.js';

const MIN_DAYS = 1;
const MAX_DAYS = 30;

export function clampRetentionDays(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.max(MIN_DAYS, Math.min(MAX_DAYS, Math.floor(n)));
}

/**
 * Hard-delete invoices past each site's invoice_retention_days.
 * Live sites with NULL retention are never touched.
 */
export async function purgeExpiredInvoices(): Promise<{ deleted: number; sites: number }> {
  const sites = await query<{ id: string; code: string; invoice_retention_days: number }>(
    `SELECT id, code, invoice_retention_days
     FROM sites
     WHERE invoice_retention_days IS NOT NULL
       AND invoice_retention_days >= $1
       AND invoice_retention_days <= $2`,
    [MIN_DAYS, MAX_DAYS],
  );

  let deleted = 0;
  for (const site of sites.rows) {
    const days = clampRetentionDays(site.invoice_retention_days);
    if (days == null) continue;

    const old = await query<{ id: string; invoice_no: string; pdf_path: string | null }>(
      `SELECT id, invoice_no, pdf_path
       FROM invoices
       WHERE site_id = $1
         AND issued_at < NOW() - ($2::int * INTERVAL '1 day')
       ORDER BY issued_at ASC
       LIMIT 500`,
      [site.id, days],
    );
    if (!old.rowCount) continue;

    const ids = old.rows.map((r) => r.id);
    await query(`UPDATE audit_logs SET invoice_id = NULL WHERE invoice_id = ANY($1::uuid[])`, [ids]);
    await query(`UPDATE invoices SET reissued_from_id = NULL WHERE reissued_from_id = ANY($1::uuid[])`, [
      ids,
    ]);
    await query(`DELETE FROM invoices WHERE id = ANY($1::uuid[])`, [ids]);

    for (const row of old.rows) {
      if (row.pdf_path) {
        try {
          if (fs.existsSync(row.pdf_path)) fs.unlinkSync(row.pdf_path);
        } catch {
          /* ignore missing file */
        }
      }
    }

    deleted += old.rows.length;
    await writeAudit({
      eventType: 'invoice.retention_purged',
      actorType: 'system',
      actorId: 'retention',
      siteId: site.id,
      detail: {
        siteCode: site.code,
        retentionDays: days,
        count: old.rows.length,
        invoiceNos: old.rows.slice(0, 20).map((r) => r.invoice_no),
      },
    });
    console.info(
      `[retention] purged ${old.rows.length} invoice(s) from ${site.code} (older than ${days}d)`,
    );
  }

  return { deleted, sites: sites.rowCount ?? 0 };
}

let timer: ReturnType<typeof setInterval> | null = null;

/** Run once at boot, then every hour. */
export function startInvoiceRetentionScheduler() {
  const run = () => {
    purgeExpiredInvoices().catch((err) => console.error('[retention] purge failed', err));
  };
  run();
  if (timer) clearInterval(timer);
  timer = setInterval(run, 60 * 60 * 1000);
}
