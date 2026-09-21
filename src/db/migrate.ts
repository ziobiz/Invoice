import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './pool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function migrate() {
  for (const file of [
    'schema.sql',
    'schema_auth.sql',
    'schema_sites_seal.sql',
    'schema_parties_site.sql',
    'schema_invoice_actor.sql',
    'schema_site_pdf_defaults.sql',
    'schema_notice_bank.sql',
    'schema_verify_token.sql',
    'schema_line_presets.sql',
    'schema_product_remark.sql',
    'schema_parties_signatory.sql',
    'schema_invoice_created_by_api.sql',
    'schema_invoice_content_edited.sql',
    'schema_reissue_actor_backfill.sql',
  ]) {
    const schemaPath = path.join(__dirname, file);
    const sql = fs.readFileSync(schemaPath, 'utf8');
    await pool.query(sql);
    console.log(`Migration OK: ${file}`);
  }
  await pool.end();
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
