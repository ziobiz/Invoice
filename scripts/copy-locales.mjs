import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'src', 'i18n', 'locales');
const dest = path.join(root, 'dist', 'i18n', 'locales');
const pub = path.join(root, 'public', 'locales');
fs.mkdirSync(dest, { recursive: true });
fs.mkdirSync(pub, { recursive: true });
for (const f of fs.readdirSync(src)) {
  if (!f.endsWith('.json')) continue;
  fs.copyFileSync(path.join(src, f), path.join(dest, f));
  fs.copyFileSync(path.join(src, f), path.join(pub, f));
}
console.log('Copied i18n locales → dist + public');
