import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './pool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function migrate() {
  for (const file of ['schema.sql', 'schema_auth.sql']) {
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
