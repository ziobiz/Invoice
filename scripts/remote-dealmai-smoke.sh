#!/usr/bin/env bash
# Issue dealmai API key + fire one test webhook; print compare summary.
# Run on Invoice host: bash scripts/remote-dealmai-smoke.sh
set -euo pipefail
cd /opt/invoice-service
# shellcheck disable=SC1091
set -a
source .env
set +a

BASE="${PUBLIC_BASE_URL:-https://invoice.icopay.net}"
# Prefer local loopback for webhook (same host)
WH_BASE="http://127.0.0.1:${PORT:-3100}"

node --input-type=module <<'EOF'
import pg from 'pg';
import crypto from 'node:crypto';
import fs from 'node:fs';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const whBase = process.env.WH_BASE || 'http://127.0.0.1:3100';

function randomToken(bytes = 18) {
  return crypto.randomBytes(bytes).toString('hex');
}
function sha256(s) {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

const site = (await pool.query(`SELECT id, code, name FROM sites WHERE code = 'dealmai' LIMIT 1`)).rows[0];
if (!site) {
  console.error('SITE_MISSING: dealmai — run npm run seed');
  process.exit(1);
}

const map = await pool.query(
  `SELECT m.active, p1.code AS seller, p1.legal_name AS seller_name,
          p2.code AS buyer, p2.legal_name AS buyer_name,
          pr.code AS product, pr.name AS product_name
   FROM site_mappings m
   JOIN parties p1 ON p1.id = m.seller_party_id
   JOIN parties p2 ON p2.id = m.buyer_party_id
   JOIN products pr ON pr.id = m.product_id
   WHERE m.site_id = $1 AND m.active = TRUE LIMIT 1`,
  [site.id],
);
if (!map.rowCount) {
  console.error('MAPPING_MISSING');
  process.exit(1);
}

await pool.query(
  `UPDATE api_keys SET active = FALSE, revoked_at = NOW()
   WHERE site_id = $1 AND label = 'dealmai-live' AND active = TRUE`,
  [site.id],
);

const apiKey = `inv_${randomToken(18)}`;
const hmacSecret = randomToken(32);
const keyPrefix = apiKey.slice(0, 12);
await pool.query(
  `INSERT INTO api_keys (site_id, label, key_prefix, key_hash, secret_hash, hmac_secret, active)
   VALUES ($1, 'dealmai-live', $2, $3, $4, $5, TRUE)`,
  [site.id, keyPrefix, sha256(apiKey), sha256(hmacSecret), hmacSecret],
);

const stamp = new Date();
const pad = (n) => String(n).padStart(2, '0');
const tx =
  `DM-TEST-${stamp.getUTCFullYear()}${pad(stamp.getUTCMonth() + 1)}${pad(stamp.getUTCDate())}-` +
  `${pad(stamp.getUTCHours())}${pad(stamp.getUTCMinutes())}${pad(stamp.getUTCSeconds())}`;
const ref = `DM-ORD-${pad(stamp.getUTCHours())}${pad(stamp.getUTCMinutes())}${pad(stamp.getUTCSeconds())}`;

const payload = {
  site: 'dealmai',
  event: 'transaction.completed',
  occurredAt: stamp.toISOString(),
  transactionId: tx,
  ticketNo: ref,
  amount: '49.00',
  currency: 'USD',
  buyerRef: 'test-dealmai@example.com',
  memo: 'DealMai Package — TEST compare (simulated ChillPay/ontheline Paid)',
  lang: 'en',
};
const body = JSON.stringify(payload);
const signature = crypto.createHmac('sha256', hmacSecret).update(body, 'utf8').digest('hex');
const idem = `dealmai:${tx}:completed`;
const ts = Math.floor(Date.now() / 1000).toString();

const res = await fetch(`${whBase}/v1/webhooks/transactions/completed`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Api-Key': apiKey,
    'X-Signature': signature,
    'X-Idempotency-Key': idem,
    'X-Timestamp': ts,
  },
  body,
});
const data = await res.json().catch(() => ({}));
console.log('=== WEBHOOK ===');
console.log(JSON.stringify({ http: res.status, ...data }, null, 2));

const replay = await fetch(`${whBase}/v1/webhooks/transactions/completed`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Api-Key': apiKey,
    'X-Signature': signature,
    'X-Idempotency-Key': idem,
    'X-Timestamp': Math.floor(Date.now() / 1000).toString(),
  },
  body,
});
const replayData = await replay.json().catch(() => ({}));
console.log('=== IDEMPOTENT REPLAY ===');
console.log(JSON.stringify({ http: replay.status, idempotentReplay: replayData.idempotentReplay, invoiceNo: replayData.invoice?.invoiceNo }, null, 2));

const invId = data.invoice?.id;
let pdfOk = null;
if (invId) {
  const pdfRes = await fetch(`${whBase}/v1/invoices/${invId}/pdf`, {
    headers: { 'X-Api-Key': apiKey },
  });
  const buf = Buffer.from(await pdfRes.arrayBuffer());
  pdfOk = { http: pdfRes.status, bytes: buf.length, contentType: pdfRes.headers.get('content-type') };
  if (pdfRes.ok) fs.writeFileSync('/tmp/dealmai-test.pdf', buf);
  console.log('=== PDF ===');
  console.log(JSON.stringify(pdfOk, null, 2));
}

const dealmaiRows = (
  await pool.query(
    `SELECT i.invoice_no, i.amount, i.currency, i.status, i.ticket_no,
            i.source_transaction_id, i.issued_at, s.code AS site_code,
            i.product_snapshot->>'code' AS product_code,
            i.product_snapshot->>'name' AS product_name,
            i.seller_snapshot->>'code' AS seller,
            i.buyer_snapshot->>'code' AS buyer
     FROM invoices i
     JOIN sites s ON s.id = i.site_id
     WHERE s.code = 'dealmai'
     ORDER BY i.issued_at DESC NULLS LAST
     LIMIT 5`,
  )
).rows;

const tinpassRows = (
  await pool.query(
    `SELECT i.invoice_no, i.amount, i.currency, i.status, i.ticket_no,
            i.source_transaction_id, i.issued_at, s.code AS site_code,
            i.product_snapshot->>'code' AS product_code
     FROM invoices i
     JOIN sites s ON s.id = i.site_id
     WHERE s.code = 'tinpass'
     ORDER BY i.issued_at DESC NULLS LAST
     LIMIT 3`,
  )
).rows;

console.log('=== DEALMAI INVOICES (DB) ===');
console.log(JSON.stringify(dealmaiRows, null, 2));
console.log('=== TINPASS RECENT (compare) ===');
console.log(JSON.stringify(tinpassRows, null, 2));

const summary = {
  mapping: map.rows[0],
  test: {
    transactionId: tx,
    ticketNo: ref,
    amount: '49.00',
    currency: 'USD',
    memo: payload.memo,
  },
  invoice: data.invoice || null,
  pdf: pdfOk,
  adminUrl: 'https://invoice.icopay.net/admin',
  filterHint: 'Admin → Invoices → search DEALMAI or site dealmai',
};
console.log('===COMPARE_SUMMARY===');
console.log(JSON.stringify(summary, null, 2));

fs.writeFileSync(
  '/root/dealmai-invoice-key.json',
  JSON.stringify(
    {
      INVOICE_BASE_URL: 'https://invoice.icopay.net',
      INVOICE_API_KEY: apiKey,
      INVOICE_HMAC_SECRET: hmacSecret,
      INVOICE_SITE_CODE: 'dealmai',
      issuedAt: new Date().toISOString(),
      label: 'dealmai-live',
      testInvoice: summary.invoice,
    },
    null,
    2,
  ) + '\n',
);
console.log('KEY_FILE=/root/dealmai-invoice-key.json');
console.log('KEY_PREFIX=' + keyPrefix);

await pool.end();
EOF
