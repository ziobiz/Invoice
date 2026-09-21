import crypto from 'node:crypto';
import speakeasy from 'speakeasy';
import nodemailer from 'nodemailer';
import { query } from '../db/pool.js';
import { sha256, randomToken } from './crypto.js';

export type PlatformConfig = {
  siteName: string;
  publicDomain: string;
  originIp: string;
  sslCertPath: string;
  otpEnabled: boolean;
  otpExpireMinutes: number;
  sensitiveOtpExpireMinutes: number;
  emailOtpEnabled: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPassword: string;
  fromAddress: string;
  fromName: string;
  otpEmailSubject: string;
  otpEmailBody: string;
  turnstileSiteKey: string;
  turnstileSecretKey: string;
  turnstileEnabled: boolean;
  cfApiToken: string;
  cfZoneId: string;
};

const DEFAULTS: PlatformConfig = {
  siteName: 'Invoice Service',
  publicDomain: 'invoice.icopay.net',
  originIp: '153.75.235.61',
  sslCertPath: '/etc/letsencrypt/live/invoice.icopay.net/fullchain.pem',
  otpEnabled: true,
  otpExpireMinutes: 5,
  sensitiveOtpExpireMinutes: 10,
  emailOtpEnabled: true,
  smtpHost: process.env.SMTP_HOST ?? '',
  smtpPort: Number(process.env.SMTP_PORT ?? 587),
  smtpSecure: process.env.SMTP_SECURE === 'true',
  smtpUser: process.env.SMTP_USER ?? '',
  smtpPassword: process.env.SMTP_PASSWORD ?? '',
  fromAddress: process.env.SMTP_FROM ?? '',
  fromName: 'Invoice Service',
  otpEmailSubject: '[Invoice] OTP {code}',
  otpEmailBody:
    'Hello {name},\n\nYour verification code: {code}\nValid for {minutes} minutes.\n\nIf you did not request this, ignore this email.',
  turnstileSiteKey: process.env.TURNSTILE_SITE_KEY ?? '',
  turnstileSecretKey: process.env.TURNSTILE_SECRET_KEY ?? '',
  turnstileEnabled: process.env.TURNSTILE_ENABLED === 'true',
  cfApiToken: process.env.CF_API_TOKEN ?? '',
  cfZoneId: process.env.CF_ZONE_ID ?? '',
};

export async function getPlatformConfig(): Promise<PlatformConfig> {
  const row = await query<{ value_json: PlatformConfig }>(
    `SELECT value_json FROM platform_settings WHERE key = 'platform'`,
  );
  if (!row.rowCount) return { ...DEFAULTS };
  return { ...DEFAULTS, ...(row.rows[0].value_json as PlatformConfig) };
}

export async function savePlatformConfig(
  patch: Partial<PlatformConfig>,
): Promise<PlatformConfig> {
  const cur = await getPlatformConfig();
  const merged: PlatformConfig = {
    ...cur,
    ...patch,
    smtpPassword:
      patch.smtpPassword && patch.smtpPassword !== '********'
        ? patch.smtpPassword
        : cur.smtpPassword,
    turnstileSecretKey:
      patch.turnstileSecretKey && patch.turnstileSecretKey !== '********'
        ? patch.turnstileSecretKey
        : cur.turnstileSecretKey,
    cfApiToken:
      patch.cfApiToken && patch.cfApiToken !== '********' ? patch.cfApiToken : cur.cfApiToken,
    otpExpireMinutes: clamp(patch.otpExpireMinutes ?? cur.otpExpireMinutes, 1, 60),
    sensitiveOtpExpireMinutes: clamp(
      patch.sensitiveOtpExpireMinutes ?? cur.sensitiveOtpExpireMinutes,
      1,
      60,
    ),
  };
  await query(
    `INSERT INTO platform_settings (key, value_json, updated_at)
     VALUES ('platform', $1::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET value_json = EXCLUDED.value_json, updated_at = NOW()`,
    [JSON.stringify(merged)],
  );
  return merged;
}

function clamp(n: number, min: number, max: number) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return min;
  return Math.min(max, Math.max(min, v));
}

export function maskSecrets(cfg: PlatformConfig) {
  return {
    ...cfg,
    smtpPassword: cfg.smtpPassword ? '********' : '',
    turnstileSecretKey: cfg.turnstileSecretKey ? '********' : '',
    cfApiToken: cfg.cfApiToken ? '********' : '',
  };
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return email;
  return `${local.slice(0, Math.min(2, local.length))}***@${domain}`;
}

export function verifyTotpCode(secret: string, code: string): boolean {
  return speakeasy.totp.verify({
    secret,
    encoding: 'base32',
    token: code.replace(/\s/g, ''),
    window: 1,
  });
}

export function generateTotpSecret(email: string): { secret: string; otpauthUrl: string } {
  const secret = speakeasy.generateSecret({
    name: `Invoice Service (${email})`,
    length: 20,
  });
  return {
    secret: secret.base32!,
    otpauthUrl: secret.otpauth_url ?? '',
  };
}

export async function createFlowToken(
  adminId: string,
  kind: 'email_otp' | 'totp_login' | 'totp_enroll' | 'change_password',
  ttlMinutes: number,
  meta: Record<string, unknown> = {},
): Promise<string> {
  const token = randomToken(32);
  await query(
    `INSERT INTO auth_flow_tokens (admin_id, token_hash, kind, expires_at, meta_json)
     VALUES ($1, $2, $3, NOW() + ($4 || ' minutes')::interval, $5::jsonb)`,
    [adminId, sha256(token), kind, String(ttlMinutes), JSON.stringify(meta)],
  );
  return token;
}

export async function consumeFlowToken(
  token: string,
  kind: string,
): Promise<{ adminId: string; meta: Record<string, unknown> } | null> {
  const hash = sha256(token);
  const row = await query(
    `UPDATE auth_flow_tokens SET consumed_at = NOW()
     WHERE token_hash = $1 AND kind = $2 AND consumed_at IS NULL AND expires_at > NOW()
     RETURNING *`,
    [hash, kind],
  );
  if (!row.rowCount) return null;
  return { adminId: row.rows[0].admin_id, meta: row.rows[0].meta_json || {} };
}

export async function peekFlowToken(
  token: string,
  kind: string,
): Promise<{ adminId: string; meta: Record<string, unknown> } | null> {
  const hash = sha256(token);
  const row = await query(
    `SELECT * FROM auth_flow_tokens
     WHERE token_hash = $1 AND kind = $2 AND consumed_at IS NULL AND expires_at > NOW()`,
    [hash, kind],
  );
  if (!row.rowCount) return null;
  return { adminId: row.rows[0].admin_id, meta: row.rows[0].meta_json || {} };
}

export async function issueEmailOtp(
  adminId: string,
  purpose: 'login' | 'enroll' | 'verify_email' | 'sensitive',
): Promise<{ code: string; expiresMinutes: number }> {
  const cfg = await getPlatformConfig();
  const code = String(crypto.randomInt(100000, 999999));
  const minutes = cfg.otpExpireMinutes || 5;
  await query(
    `INSERT INTO admin_email_otps (admin_id, code_hash, purpose, expires_at)
     VALUES ($1, $2, $3, NOW() + ($4 || ' minutes')::interval)`,
    [adminId, sha256(code), purpose, String(minutes)],
  );
  return { code, expiresMinutes: minutes };
}

export async function verifyEmailOtp(
  adminId: string,
  purpose: string,
  code: string,
): Promise<boolean> {
  const hash = sha256(code.replace(/\s/g, ''));
  const row = await query(
    `SELECT id FROM admin_email_otps
     WHERE admin_id = $1 AND purpose = $2 AND code_hash = $3
       AND consumed_at IS NULL AND expires_at > NOW()
     ORDER BY created_at DESC LIMIT 1`,
    [adminId, purpose, hash],
  );
  if (!row.rowCount) return false;
  await query(`UPDATE admin_email_otps SET consumed_at = NOW() WHERE id = $1`, [row.rows[0].id]);
  return true;
}

export function isSmtpConfigured(cfg: PlatformConfig): boolean {
  return Boolean(cfg.smtpHost && cfg.fromAddress);
}

export async function sendOtpEmail(
  to: string,
  name: string,
  code: string,
  minutes: number,
): Promise<void> {
  const cfg = await getPlatformConfig();
  if (!isSmtpConfigured(cfg)) {
    console.warn(`[email-otp] SMTP not configured — code for ${to}: ${code}`);
    return;
  }
  const subject = cfg.otpEmailSubject
    .replaceAll('{code}', code)
    .replaceAll('{name}', name)
    .replaceAll('{minutes}', String(minutes));
  const body = cfg.otpEmailBody
    .replaceAll('{code}', code)
    .replaceAll('{name}', name)
    .replaceAll('{minutes}', String(minutes));
  const transporter = nodemailer.createTransport({
    host: cfg.smtpHost,
    port: cfg.smtpPort,
    secure: cfg.smtpSecure,
    auth: cfg.smtpUser ? { user: cfg.smtpUser, pass: cfg.smtpPassword } : undefined,
  });
  await transporter.sendMail({
    from: `"${cfg.fromName}" <${cfg.fromAddress}>`,
    to,
    subject,
    text: body,
  });
}

export async function assertTurnstile(token: string | undefined, ip?: string): Promise<void> {
  const cfg = await getPlatformConfig();
  if (!cfg.turnstileEnabled) return;
  if (!cfg.turnstileSecretKey) {
    const err = Object.assign(new Error('api.error.turnstileConfig'), { status: 503, errorKey: 'api.error.turnstileConfig' });
    throw err;
  }
  if (!token) {
    const err = Object.assign(new Error('api.error.turnstileRequired'), {
      status: 400,
      errorKey: 'api.error.turnstileRequired',
    });
    throw err;
  }
  const body = new URLSearchParams({
    secret: cfg.turnstileSecretKey,
    response: token,
  });
  if (ip) body.set('remoteip', ip);
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body,
  });
  const data = (await res.json()) as { success?: boolean };
  if (!data.success) {
    const err = Object.assign(new Error('api.error.turnstileFailed'), {
      status: 403,
      errorKey: 'api.error.turnstileFailed',
    });
    throw err;
  }
}

export async function fetchCloudflareStatus(): Promise<{
  configured: boolean;
  records?: unknown[];
  error?: string;
}> {
  const cfg = await getPlatformConfig();
  if (!cfg.cfApiToken || !cfg.cfZoneId) {
    return { configured: false };
  }
  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${cfg.cfZoneId}/dns_records?name=invoice.icopay.net`,
      {
        headers: {
          Authorization: `Bearer ${cfg.cfApiToken}`,
          'Content-Type': 'application/json',
        },
      },
    );
    const data = (await res.json()) as { success?: boolean; result?: unknown[]; errors?: { message: string }[] };
    if (!data.success) {
      return { configured: true, error: data.errors?.[0]?.message || 'CF API error' };
    }
    return { configured: true, records: data.result || [] };
  } catch (e) {
    return { configured: true, error: (e as Error).message };
  }
}

export async function readSslStatus(certPath: string): Promise<{
  status: string;
  detail: string;
  daysRemaining: number | null;
}> {
  try {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execFileAsync = promisify(execFile);
    if (!certPath) {
      return { status: 'unknown', detail: 'No cert path configured', daysRemaining: null };
    }
    const { stdout } = await execFileAsync('openssl', [
      'x509',
      '-enddate',
      '-noout',
      '-in',
      certPath,
    ]);
    const m = stdout.match(/notAfter=(.+)/);
    if (!m) return { status: 'unknown', detail: stdout.trim(), daysRemaining: null };
    const end = new Date(m[1]);
    const days = Math.floor((end.getTime() - Date.now()) / (24 * 3600 * 1000));
    return {
      status: days < 0 ? 'expired' : days < 30 ? 'expiring' : 'ok',
      detail: end.toISOString(),
      daysRemaining: days,
    };
  } catch (e) {
    return { status: 'unavailable', detail: (e as Error).message, daysRemaining: null };
  }
}
