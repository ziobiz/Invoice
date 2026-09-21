import 'dotenv/config';
import path from 'node:path';

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 3100),
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? 'http://localhost:3100',
  databaseUrl: required('DATABASE_URL', 'postgres://invoice:invoice@127.0.0.1:5432/invoice'),
  adminEmail: process.env.ADMIN_EMAIL ?? 'admin@localhost',
  adminPassword: process.env.ADMIN_PASSWORD ?? 'changeme',
  adminName: process.env.ADMIN_NAME ?? 'HQ Admin',
  sessionSecret: required('SESSION_SECRET', 'dev-session-secret-change-me'),
  webhookMaxSkewSeconds: Number(process.env.WEBHOOK_MAX_SKEW_SECONDS ?? 300),
  pdfStorageDir: path.resolve(process.env.PDF_STORAGE_DIR ?? './storage/pdfs'),
  sealStorageDir: path.resolve(process.env.SEAL_STORAGE_DIR ?? './storage/seals'),
  invoiceTz: process.env.INVOICE_TZ ?? 'Asia/Seoul',
};
