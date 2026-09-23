#!/usr/bin/env bash
# Issue (or rotate) tinpass-sim API key for Crypto simulator webhook.
# Run on Invoice host: bash scripts/remote-issue-tinpass-sim-key.sh
set -euo pipefail
cd /opt/invoice-service
# shellcheck disable=SC1091
set -a
source .env
set +a

node --input-type=module <<'EOF'
import pg from 'pg';
import crypto from 'node:crypto';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

function randomToken(bytes = 18) {
  return crypto.randomBytes(bytes).toString('hex');
}
function sha256(s) {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

const site = (await pool.query(`SELECT id, code FROM sites WHERE lower(code) = 'tinpass-sim' LIMIT 1`))
  .rows[0];
if (!site) {
  console.error('SITE_MISSING tinpass-sim — run migrate first');
  process.exit(1);
}

const map = await pool.query(
  `SELECT m.active, p1.code AS seller, p2.code AS buyer, pr.code AS product
   FROM site_mappings m
   JOIN parties p1 ON p1.id = m.seller_party_id
   JOIN parties p2 ON p2.id = m.buyer_party_id
   JOIN products pr ON pr.id = m.product_id
   WHERE m.site_id = $1 AND m.active = TRUE LIMIT 1`,
  [site.id],
);
if (!map.rowCount) {
  console.error('MAPPING_MISSING for tinpass-sim');
  process.exit(1);
}

await pool.query(
  `UPDATE api_keys SET active = FALSE, revoked_at = NOW()
   WHERE site_id = $1 AND label = 'tinpass-crypto-sim' AND active = TRUE`,
  [site.id],
);

const apiKey = `inv_${randomToken(18)}`;
const hmacSecret = randomToken(32);
const keyPrefix = apiKey.slice(0, 12);
await pool.query(
  `INSERT INTO api_keys (site_id, label, key_prefix, key_hash, secret_hash, hmac_secret, active)
   VALUES ($1, 'tinpass-crypto-sim', $2, $3, $4, $5, TRUE)`,
  [site.id, keyPrefix, sha256(apiKey), sha256(hmacSecret), hmacSecret],
);

console.log('SITE=' + site.code);
console.log('SELLER=' + map.rows[0].seller);
console.log('BUYER=' + map.rows[0].buyer);
console.log('PRODUCT=' + map.rows[0].product);
console.log('INVOICE_SIM_API_KEY=' + apiKey);
console.log('INVOICE_SIM_HMAC_SECRET=' + hmacSecret);
console.log('INVOICE_SIM_SITE_CODE=tinpass-sim');
console.log('INVOICE_SIM_ENABLED=true');
await pool.end();
EOF
