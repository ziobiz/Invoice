#!/usr/bin/env bash
set -euo pipefail
cd /opt/invoice-service
set -a
# shellcheck disable=SC1091
source .env
set +a
node --input-type=module <<'EOF'
import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const before = await pool.query(`SELECT value_json->>'authMainText' AS t FROM platform_settings WHERE key = 'platform'`);
console.log('BEFORE=', before.rows[0]?.t || '');
await pool.query(`
  UPDATE platform_settings
  SET value_json = jsonb_set(COALESCE(value_json, '{}'::jsonb), '{authMainText}', '""'::jsonb, true),
      updated_at = NOW()
  WHERE key = 'platform'
`);
const after = await pool.query(`SELECT value_json->>'authMainText' AS t FROM platform_settings WHERE key = 'platform'`);
console.log('AFTER=', JSON.stringify(after.rows[0]?.t ?? null));
await pool.end();
EOF
