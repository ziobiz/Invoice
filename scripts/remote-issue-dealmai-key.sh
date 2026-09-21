#!/usr/bin/env bash
set -euo pipefail
cd /opt/invoice-service
set -a
# shellcheck disable=SC1091
source .env
set +a
node --input-type=module <<'EOF'
import pg from 'pg';
import crypto from 'node:crypto';
import fs from 'node:fs';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const site = (await pool.query(`SELECT id FROM sites WHERE code = 'dealmai'`)).rows[0];
if (!site) {
  console.error('NO_SITE');
  process.exit(1);
}
await pool.query(
  `UPDATE api_keys SET active = FALSE, revoked_at = NOW()
   WHERE site_id = $1 AND label = 'dealmai-live' AND active = TRUE`,
  [site.id],
);
const apiKey = `inv_${crypto.randomBytes(18).toString('hex')}`;
const hmacSecret = crypto.randomBytes(32).toString('hex');
const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
await pool.query(
  `INSERT INTO api_keys (site_id, label, key_prefix, key_hash, secret_hash, hmac_secret, active)
   VALUES ($1, 'dealmai-live', $2, $3, $4, $5, TRUE)`,
  [site.id, apiKey.slice(0, 12), sha(apiKey), sha(hmacSecret), hmacSecret],
);
const payload = {
  INVOICE_BASE_URL: 'https://invoice.icopay.net',
  INVOICE_API_KEY: apiKey,
  INVOICE_HMAC_SECRET: hmacSecret,
  INVOICE_SITE_CODE: 'dealmai',
  issuedAt: new Date().toISOString(),
  label: 'dealmai-live',
};
fs.writeFileSync('/root/dealmai-invoice-key.json', JSON.stringify(payload, null, 2) + '\n');
fs.chmodSync('/root/dealmai-invoice-key.json', 0o600);
console.log('KEY_SAVED=/root/dealmai-invoice-key.json');
console.log('PREFIX=' + apiKey.slice(0, 12));
await pool.end();
EOF
