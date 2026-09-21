import { query } from '../db/pool.js';
import { randomToken, sha256 } from './crypto.js';

export async function createApiKey(siteId: string, label = 'default') {
  const apiKey = `inv_${randomToken(18)}`;
  const hmacSecret = randomToken(32);
  const keyPrefix = apiKey.slice(0, 12);
  const keyHash = sha256(apiKey);
  const secretHash = sha256(hmacSecret);

  const row = await query(
    `INSERT INTO api_keys (site_id, label, key_prefix, key_hash, secret_hash, hmac_secret, active)
     VALUES ($1, $2, $3, $4, $5, $6, TRUE)
     RETURNING id, site_id, label, key_prefix, active, created_at`,
    [siteId, label, keyPrefix, keyHash, secretHash, hmacSecret],
  );

  return {
    record: row.rows[0],
    apiKey, // shown once
    hmacSecret, // shown once
  };
}

export async function findActiveKeyByRaw(apiKey: string) {
  const prefix = apiKey.slice(0, 12);
  const hash = sha256(apiKey);
  const res = await query(
    `SELECT k.*, s.code AS site_code, s.active AS site_active
     FROM api_keys k
     JOIN sites s ON s.id = k.site_id
     WHERE k.key_prefix = $1 AND k.key_hash = $2 AND k.active = TRUE AND k.revoked_at IS NULL`,
    [prefix, hash],
  );
  return res.rows[0] ?? null;
}

export async function revokeApiKey(id: string) {
  await query(
    `UPDATE api_keys SET active = FALSE, revoked_at = NOW() WHERE id = $1`,
    [id],
  );
}

export async function touchApiKey(id: string) {
  await query(`UPDATE api_keys SET last_used_at = NOW() WHERE id = $1`, [id]);
}
