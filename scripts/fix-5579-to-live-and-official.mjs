/**
 * Reclassify USDT-20260928-5579 from sandbox → live, regenerate PDF,
 * then issue missing official sibling.
 */
import 'dotenv/config';
import { query } from '../dist/db/pool.js';
import { issueFromWebhook } from '../dist/services/invoice.js';
import { generateInvoicePdf } from '../dist/services/pdf.js';
import { sealConfigFromSite, pdfDefaultsFromSite } from '../dist/services/seal.js';
import { randomToken } from '../dist/services/crypto.js';
import { config } from '../dist/config.js';

const TICKET = 'USDT-20260928-5579';
const SITE = 'tinpass';

function verifyUrlFor(token) {
  const base = (config.publicBaseUrl || '').replace(/\/$/, '') || 'http://localhost:3100';
  return `${base}/verify/${encodeURIComponent(token)}`;
}

function stripSandbox(memo) {
  return String(memo || '')
    .replace(/^\[SANDBOX\]\s*/i, '')
    .replace(/^\|\s*/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

async function refreshPdf(inv, siteRow) {
  const seller = inv.seller_snapshot;
  const buyer = inv.buyer_snapshot;
  const product = inv.product_snapshot || {};
  const seal = sealConfigFromSite(siteRow, seller?.legal_name);
  const sitePdf = pdfDefaultsFromSite(siteRow);
  let verifyToken = inv.verify_token;
  if (!verifyToken) {
    verifyToken = randomToken(24);
    await query(`UPDATE invoices SET verify_token = $2 WHERE id = $1`, [inv.id, verifyToken]);
  }
  const items = await query(
    `SELECT * FROM invoice_items WHERE invoice_id = $1 ORDER BY line_no`,
    [inv.id],
  );
  const remarkText = String(product.remark || '').trim() || '';
  const lineItems =
    items.rowCount && items.rows.length
      ? items.rows.map((r) => ({
          item: String(product.name || r.product_code || ''),
          description: String(r.description || product.description || product.name || ''),
          unitPrice: String(r.unit_price),
          quantity: String(r.quantity),
          amount: String(r.amount),
          unit: String(r.unit || inv.asset || product.unit || 'EA'),
          remark: remarkText,
        }))
      : [
          {
            item: product.name || product.code || '',
            description: product.description || product.name || '',
            unitPrice: String(inv.amount),
            quantity: inv.asset_amount != null ? String(inv.asset_amount) : '1',
            amount: String(inv.amount),
            unit: String(inv.asset || product.unit || 'EA'),
            remark: remarkText,
          },
        ];

  const pdf = await generateInvoicePdf({
    invoiceNo: String(inv.invoice_no),
    issuedAt: new Date(String(inv.issued_at)),
    currency: String(inv.currency),
    amount: String(inv.amount),
    asset: inv.asset != null ? String(inv.asset) : null,
    assetAmount: inv.asset_amount != null ? String(inv.asset_amount) : null,
    ticketNo: inv.ticket_no != null ? String(inv.ticket_no) : null,
    sourceTransactionId: String(inv.source_transaction_id || ''),
    sourceSite: SITE,
    memo: inv.memo != null ? String(inv.memo) : null,
    seller,
    buyer,
    lineItems,
    seal,
    sitePdf,
    verifyUrl: verifyUrlFor(verifyToken),
  });
  await query(
    `UPDATE invoices SET pdf_path = $2, pdf_hash = $3, pdf_regenerated_at = NOW(), updated_at = NOW()
     WHERE id = $1`,
    [inv.id, pdf.relativePath, pdf.pdfHash],
  );
  return pdf;
}

async function main() {
  const site = await query(`SELECT * FROM sites WHERE code = $1 LIMIT 1`, [SITE]);
  if (!site.rowCount) throw new Error('site missing');
  const siteRow = site.rows[0];
  const siteId = siteRow.id;

  const rows = await query(
    `SELECT * FROM invoices
     WHERE site_id = $1 AND ticket_no = $2
       AND deleted_at IS NULL AND status <> 'void'
     ORDER BY issued_at ASC`,
    [siteId, TICKET],
  );
  if (!rows.rowCount) throw new Error(`invoice not found for ${TICKET}`);

  let live = null;
  for (const inv of rows.rows) {
    const memo = String(inv.memo || '');
    if (memo.startsWith('[OFFICIAL]')) continue;
    if (memo.startsWith('[SANDBOX]') || !memo.startsWith('[')) {
      live = inv;
      break;
    }
  }
  if (!live) live = rows.rows.find((r) => !String(r.memo || '').startsWith('[OFFICIAL]'));
  if (!live) throw new Error('no live/sandbox row to reclassify');

  const newMemo = stripSandbox(live.memo) || 'USDT tx: TXID';
  const raw =
    live.raw_payload && typeof live.raw_payload === 'object' ? { ...live.raw_payload } : {};
  raw.memo = newMemo;

  await query(
    `UPDATE invoices
     SET memo = $2, raw_payload = $3::jsonb, updated_at = NOW()
     WHERE id = $1`,
    [live.id, newMemo, JSON.stringify(raw)],
  );
  console.log(`UPDATED live memo ${live.invoice_no}: ${JSON.stringify(live.memo)} → ${JSON.stringify(newMemo)}`);

  const refreshed = await query(`SELECT * FROM invoices WHERE id = $1`, [live.id]);
  const inv = refreshed.rows[0];
  const pdf = await refreshPdf(inv, siteRow);
  console.log(`PDF regenerated ${inv.invoice_no} hash=${pdf.pdfHash}`);

  const txId = String(inv.source_transaction_id || '').trim();
  const officialExisting = await query(
    `SELECT invoice_no FROM invoices
     WHERE site_id = $1 AND source_transaction_id = $2
       AND deleted_at IS NULL AND status <> 'void'
       AND memo LIKE '[OFFICIAL]%'
     LIMIT 1`,
    [siteId, txId],
  );
  if (officialExisting.rowCount) {
    console.log(`OFFICIAL already exists: ${officialExisting.rows[0].invoice_no}`);
  } else {
    const officialMemo = newMemo ? `[OFFICIAL] | ${newMemo}` : '[OFFICIAL]';
    const body = {
      site: SITE,
      event: String(raw.event || 'transaction.completed'),
      occurredAt:
        raw.occurredAt ||
        (inv.issued_at ? new Date(inv.issued_at).toISOString() : new Date().toISOString()),
      transactionId: txId,
      ticketNo: inv.ticket_no || undefined,
      amount: String(inv.amount),
      currency: String(inv.currency || 'JPY'),
      asset: inv.asset || 'USDT',
      assetAmount: inv.asset_amount != null ? String(inv.asset_amount) : undefined,
      buyerRef: inv.buyer_ref || raw.buyerRef || undefined,
      productCode: raw.productCode || 'USDT-PURCHASE',
      memo: officialMemo,
    };
    const result = await issueFromWebhook({
      siteId,
      siteCode: SITE,
      idempotencyKey: `tinpass:usdt:${txId}:official:ordered`,
      body,
      actorType: 'system',
    });
    console.log(
      `OFFICIAL ${result.idempotentReplay ? 'REPLAY' : 'CREATED'} ${result.invoice.invoice_no}`,
    );
  }

  const after = await query(
    `SELECT invoice_no, ticket_no,
            CASE
              WHEN memo LIKE '[SIMULATOR]%' THEN 'simulator'
              WHEN memo LIKE '[SANDBOX]%' THEN 'sandbox'
              WHEN memo LIKE '[OFFICIAL]%' THEN 'official'
              ELSE 'live'
            END AS kind,
            amount::text, currency, memo
     FROM invoices
     WHERE site_id = $1 AND ticket_no = $2
       AND deleted_at IS NULL AND status <> 'void'
     ORDER BY issued_at`,
    [siteId, TICKET],
  );
  console.log(JSON.stringify({ ok: true, items: after.rows }, null, 2));
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
