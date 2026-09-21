import crypto from 'node:crypto';
import { query } from '../db/pool.js';

export async function writeAudit(input: {
  eventType: string;
  actorType: 'system' | 'admin' | 'site';
  actorId?: string | null;
  siteId?: string | null;
  invoiceId?: string | null;
  detail?: Record<string, unknown>;
  ip?: string | null;
}) {
  await query(
    `INSERT INTO audit_logs (event_type, actor_type, actor_id, site_id, invoice_id, detail_json, ip)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
    [
      input.eventType,
      input.actorType,
      input.actorId ?? null,
      input.siteId ?? null,
      input.invoiceId ?? null,
      JSON.stringify(input.detail ?? {}),
      input.ip ?? null,
    ],
  );
}

export function sha256(input: string): string {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

export function hmacSha256(secret: string, body: string): string {
  return crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex');
}

export function timingSafeEqualHex(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, 'hex');
    const bb = Buffer.from(b, 'hex');
    if (ba.length !== bb.length) return false;
    return crypto.timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

export function randomToken(bytes = 24): string {
  return crypto.randomBytes(bytes).toString('base64url');
}
