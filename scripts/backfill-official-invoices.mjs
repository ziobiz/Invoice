/**
 * Backfill official (원본) invoices for existing live tinpass trades.
 *
 * For each live invoice that has no sibling with memo [OFFICIAL]% and the same
 * source_transaction_id, issue an official invoice via issueFromWebhook.
 *
 * Usage (on server):
 *   node scripts/backfill-official-invoices.mjs [--dry-run] [--site=tinpass]
 */
import 'dotenv/config';
import { query } from '../dist/db/pool.js';
import { issueFromWebhook } from '../dist/services/invoice.js';
import { isOfficialMemo } from '../dist/services/invoice-brand.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const siteArg = args.find((a) => a.startsWith('--site='));
const siteCode = siteArg ? siteArg.slice('--site='.length) : 'tinpass';

function stripKindPrefix(memo) {
  return String(memo || '')
    .replace(/^\[(SIMULATOR|SANDBOX|OFFICIAL)(?::[^\]]*)?\]\s*/i, '')
    .replace(/^\|\s*/, '')
    .trim();
}

async function main() {
  const site = await query(`SELECT id, code FROM sites WHERE code = $1 LIMIT 1`, [siteCode]);
  if (!site.rowCount) {
    throw new Error(`site not found: ${siteCode}`);
  }
  const siteId = site.rows[0].id;

  const live = await query(
    `SELECT id, invoice_no, ticket_no, source_transaction_id, issued_at,
            currency, amount::text AS amount, asset, asset_amount::text AS asset_amount,
            buyer_ref, memo, idempotency_key, raw_payload
     FROM invoices
     WHERE site_id = $1
       AND deleted_at IS NULL
       AND status <> 'void'
       AND (memo IS NULL OR (
         memo NOT LIKE '[SIMULATOR]%'
         AND memo NOT LIKE '[SANDBOX]%'
         AND memo NOT LIKE '[OFFICIAL]%'
       ))
     ORDER BY issued_at ASC`,
    [siteId],
  );

  console.log(`site=${siteCode} live_candidates=${live.rowCount} dryRun=${dryRun}`);

  let created = 0;
  let skipped = 0;
  let replayed = 0;

  for (const row of live.rows) {
    const txId = String(row.source_transaction_id || '').trim();
    if (!txId) {
      console.log(`SKIP no tx id invoice=${row.invoice_no}`);
      skipped += 1;
      continue;
    }

    const existingOfficial = await query(
      `SELECT id, invoice_no FROM invoices
       WHERE site_id = $1
         AND source_transaction_id = $2
         AND deleted_at IS NULL
         AND status <> 'void'
         AND memo IS NOT NULL AND memo LIKE '[OFFICIAL]%'
       LIMIT 1`,
      [siteId, txId],
    );
    if (existingOfficial.rowCount) {
      console.log(
        `SKIP already official ${existingOfficial.rows[0].invoice_no} for live ${row.invoice_no}`,
      );
      skipped += 1;
      continue;
    }

    const raw =
      row.raw_payload && typeof row.raw_payload === 'object' ? row.raw_payload : {};
    const restMemo = stripKindPrefix(row.memo);
    const officialMemo = restMemo ? `[OFFICIAL] | ${restMemo}` : '[OFFICIAL]';
    if (!isOfficialMemo(officialMemo)) {
      throw new Error(`official memo build failed for ${row.invoice_no}`);
    }

    const body = {
      site: siteCode,
      event: String(raw.event || 'transaction.ordered'),
      occurredAt:
        raw.occurredAt ||
        (row.issued_at ? new Date(row.issued_at).toISOString() : new Date().toISOString()),
      transactionId: txId,
      ticketNo: row.ticket_no || raw.ticketNo || undefined,
      amount: String(row.amount ?? raw.amount),
      currency: String(row.currency || raw.currency || 'USD'),
      asset: row.asset || raw.asset || undefined,
      assetAmount:
        row.asset_amount != null
          ? String(row.asset_amount)
          : raw.assetAmount != null
            ? String(raw.assetAmount)
            : undefined,
      buyerRef: row.buyer_ref || raw.buyerRef || undefined,
      productCode: raw.productCode || 'USDT-PURCHASE',
      memo: officialMemo,
    };

    // Same key as TINPASS dual-issue path so retries stay idempotent.
    const idempotencyKey = `tinpass:usdt:${txId}:official:ordered`;

    console.log(
      `${dryRun ? 'DRY' : 'CREATE'} official for live=${row.invoice_no} tx=${txId} ticket=${body.ticketNo || '-'}`,
    );
    if (dryRun) {
      created += 1;
      continue;
    }

    const result = await issueFromWebhook({
      siteId,
      siteCode,
      idempotencyKey,
      body,
      actorType: 'system',
    });
    if (result.idempotentReplay) {
      console.log(`REPLAY ${result.invoice.invoice_no}`);
      replayed += 1;
    } else {
      console.log(`CREATED ${result.invoice.invoice_no}`);
      created += 1;
    }
  }

  console.log(
    JSON.stringify({ ok: true, siteCode, dryRun, created, skipped, replayed }, null, 2),
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
