import { Router } from 'express';
import bcrypt from 'bcryptjs';
import QRCode from 'qrcode';
import { query } from '../db/pool.js';
import { writeAudit } from '../services/crypto.js';
import { requireAdmin, requireHq } from '../middleware/auth.js';
import { jsonError } from '../middleware/i18n.js';
import {
  assertTurnstile,
  consumeFlowToken,
  createFlowToken,
  generateTotpSecret,
  getPlatformConfig,
  issueEmailOtp,
  isSmtpConfigured,
  maskEmail,
  peekFlowToken,
  sendOtpEmail,
  verifyEmailOtp,
  verifyTotpCode,
} from '../services/platform.js';

export const authRouter = Router();

function clientIp(req: import('express').Request): string | undefined {
  const cf = req.headers['cf-connecting-ip'];
  if (typeof cf === 'string' && cf.trim()) return cf.trim();
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0]?.trim();
  }
  return req.ip || req.socket?.remoteAddress || undefined;
}

/** 세션은 OTP/비밀번호 변경 등 전체 로그인 완료 시에만 부여한다. */
async function finishLogin(
  req: import('express').Request,
  admin: { id: string; email: string; name: string; role: string } | Record<string, unknown>,
) {
  const a = admin as { id: string; email: string; name: string; role: string };
  await new Promise<void>((resolve, reject) => {
    req.session.regenerate((err) => (err ? reject(err) : resolve()));
  });
  req.session.adminId = a.id;
  await query(`UPDATE admins SET last_login_at = NOW() WHERE id = $1`, [a.id]);
  await writeAudit({
    eventType: 'admin.login',
    actorType: 'admin',
    actorId: a.id,
    detail: { email: a.email },
    ip: clientIp(req),
  });
  return {
    admin: {
      id: a.id,
      email: a.email,
      name: a.name,
      role: a.role,
    },
    locale: req.locale,
  };
}

authRouter.get('/public-config', async (_req, res, next) => {
  try {
    const cfg = await getPlatformConfig();
    res.json({
      siteName: cfg.siteName,
      turnstileEnabled: cfg.turnstileEnabled && Boolean(cfg.turnstileSiteKey),
      turnstileSiteKey: cfg.turnstileEnabled ? cfg.turnstileSiteKey : '',
      turnstileDisplayMode: cfg.turnstileDisplayMode === 'banner' ? 'banner' : 'text',
      otpEnabled: cfg.otpEnabled,
      emailOtpEnabled: cfg.emailOtpEnabled,
    });
  } catch (e) {
    next(e);
  }
});

authRouter.post('/login', async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const turnstileToken = req.body.turnstileToken as string | undefined;
    await assertTurnstile(turnstileToken, clientIp(req));

    const row = await query(`SELECT * FROM admins WHERE email = $1 AND active = TRUE`, [email]);
    if (!row.rowCount) {
      jsonError(res, 401, 'api.error.invalidCredentials', req);
      return;
    }
    const admin = row.rows[0];
    const ok = await bcrypt.compare(password, admin.password_hash);
    if (!ok) {
      jsonError(res, 401, 'api.error.invalidCredentials', req);
      return;
    }

    const cfg = await getPlatformConfig();

    if (admin.must_change_password) {
      const changeToken = await createFlowToken(admin.id, 'change_password', 30);
      res.json({
        mustChangePassword: true,
        changeToken,
        locale: req.locale,
      });
      return;
    }

    if (cfg.emailOtpEnabled && isSmtpConfigured(cfg)) {
      const { code, expiresMinutes } = await issueEmailOtp(admin.id, 'login');
      await sendOtpEmail(admin.email, admin.name, code, expiresMinutes);
      const emailToken = await createFlowToken(admin.id, 'email_otp', expiresMinutes);
      res.json({
        needEmailOtp: true,
        emailToken,
        maskedEmail: maskEmail(admin.email),
        locale: req.locale,
      });
      return;
    }

    if (cfg.otpEnabled && !admin.totp_enabled) {
      const enrollToken = await createFlowToken(admin.id, 'totp_enroll', 30);
      res.json({
        needTotpEnroll: true,
        enrollToken,
        locale: req.locale,
      });
      return;
    }

    if (cfg.otpEnabled && admin.totp_enabled) {
      const otpToken = await createFlowToken(admin.id, 'totp_login', cfg.sensitiveOtpExpireMinutes || 10);
      res.json({
        needTotp: true,
        otpToken,
        locale: req.locale,
      });
      return;
    }

    res.json(await finishLogin(req, admin));
  } catch (err) {
    const e = err as { status?: number; errorKey?: string };
    if (e.status && e.errorKey) {
      jsonError(res, e.status, e.errorKey, req);
      return;
    }
    next(err);
  }
});

authRouter.post('/change-password', async (req, res, next) => {
  try {
    const changeToken = String(req.body.changeToken || '');
    const newPassword = String(req.body.newPassword || '');
    if (newPassword.length < 8) {
      jsonError(res, 400, 'api.error.weakPassword', req);
      return;
    }
    const flow = await consumeFlowToken(changeToken, 'change_password');
    if (!flow) {
      jsonError(res, 401, 'api.error.unauthorized', req);
      return;
    }
    const hash = await bcrypt.hash(newPassword, 12);
    await query(
      `UPDATE admins SET password_hash = $2, must_change_password = FALSE, updated_at = NOW() WHERE id = $1`,
      [flow.adminId, hash],
    );
    const admin = (await query(`SELECT * FROM admins WHERE id = $1`, [flow.adminId])).rows[0];
    const cfg = await getPlatformConfig();
    if (cfg.otpEnabled && !admin.totp_enabled) {
      const enrollToken = await createFlowToken(admin.id, 'totp_enroll', 30);
      res.json({ needTotpEnroll: true, enrollToken, locale: req.locale });
      return;
    }
    if (cfg.otpEnabled && admin.totp_enabled) {
      const otpToken = await createFlowToken(admin.id, 'totp_login', cfg.sensitiveOtpExpireMinutes || 10);
      res.json({ needTotp: true, otpToken, locale: req.locale });
      return;
    }
    res.json(await finishLogin(req, admin));
  } catch (e) {
    next(e);
  }
});

authRouter.post('/email-otp/verify', async (req, res, next) => {
  try {
    const emailToken = String(req.body.emailToken || '');
    const code = String(req.body.code || '');
    const flow = await peekFlowToken(emailToken, 'email_otp');
    if (!flow) {
      jsonError(res, 401, 'api.error.invalidOtp', req);
      return;
    }
    const ok = await verifyEmailOtp(flow.adminId, 'login', code);
    if (!ok) {
      jsonError(res, 401, 'api.error.invalidOtp', req);
      return;
    }
    await consumeFlowToken(emailToken, 'email_otp');
    await query(
      `UPDATE admins SET email_verified_at = COALESCE(email_verified_at, NOW()) WHERE id = $1`,
      [flow.adminId],
    );
    const admin = (await query(`SELECT * FROM admins WHERE id = $1`, [flow.adminId])).rows[0];
    const cfg = await getPlatformConfig();
    if (cfg.otpEnabled && !admin.totp_enabled) {
      const enrollToken = await createFlowToken(admin.id, 'totp_enroll', 30);
      res.json({ needTotpEnroll: true, enrollToken, locale: req.locale });
      return;
    }
    if (cfg.otpEnabled && admin.totp_enabled) {
      const otpToken = await createFlowToken(admin.id, 'totp_login', cfg.sensitiveOtpExpireMinutes || 10);
      res.json({ needTotp: true, otpToken, locale: req.locale });
      return;
    }
    res.json(await finishLogin(req, admin));
  } catch (e) {
    next(e);
  }
});

authRouter.post('/totp/enroll/start', async (req, res, next) => {
  try {
    const enrollToken = String(req.body.enrollToken || '');
    const flow = await peekFlowToken(enrollToken, 'totp_enroll');
    if (!flow) {
      jsonError(res, 401, 'api.error.unauthorized', req);
      return;
    }
    const admin = (await query(`SELECT * FROM admins WHERE id = $1`, [flow.adminId])).rows[0];
    const { secret, otpauthUrl } = generateTotpSecret(admin.email);
    await query(`UPDATE admins SET totp_pending_secret = $2 WHERE id = $1`, [admin.id, secret]);
    const qrDataUrl = await QRCode.toDataURL(otpauthUrl);
    res.json({ otpauthUrl, qrDataUrl, locale: req.locale });
  } catch (e) {
    next(e);
  }
});

authRouter.post('/totp/enroll/confirm', async (req, res, next) => {
  try {
    const enrollToken = String(req.body.enrollToken || '');
    const code = String(req.body.code || '');
    const flow = await peekFlowToken(enrollToken, 'totp_enroll');
    if (!flow) {
      jsonError(res, 401, 'api.error.unauthorized', req);
      return;
    }
    const admin = (await query(`SELECT * FROM admins WHERE id = $1`, [flow.adminId])).rows[0];
    if (!admin.totp_pending_secret || !verifyTotpCode(admin.totp_pending_secret, code)) {
      jsonError(res, 401, 'api.error.invalidOtp', req);
      return;
    }
    await query(
      `UPDATE admins SET totp_secret = totp_pending_secret, totp_enabled = TRUE, totp_pending_secret = NULL, updated_at = NOW()
       WHERE id = $1`,
      [admin.id],
    );
    await consumeFlowToken(enrollToken, 'totp_enroll');
    const updated = (await query(`SELECT * FROM admins WHERE id = $1`, [admin.id])).rows[0];
    res.json(await finishLogin(req, updated));
  } catch (e) {
    next(e);
  }
});

authRouter.post('/totp/verify', async (req, res, next) => {
  try {
    const otpToken = String(req.body.otpToken || '');
    const code = String(req.body.code || '');
    const flow = await peekFlowToken(otpToken, 'totp_login');
    if (!flow) {
      jsonError(res, 401, 'api.error.unauthorized', req);
      return;
    }
    const admin = (await query(`SELECT * FROM admins WHERE id = $1`, [flow.adminId])).rows[0];
    if (!admin?.totp_secret || !verifyTotpCode(admin.totp_secret, code)) {
      jsonError(res, 401, 'api.error.invalidOtp', req);
      return;
    }
    await consumeFlowToken(otpToken, 'totp_login');
    res.json(await finishLogin(req, admin));
  } catch (e) {
    next(e);
  }
});

authRouter.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

authRouter.get('/me', requireAdmin, async (req, res, next) => {
  try {
    const row = await query(
      `SELECT id, email, name, role, totp_enabled, email_verified_at, last_login_at
       FROM admins WHERE id = $1 AND active = TRUE`,
      [req.session.adminId],
    );
    if (!row.rowCount) {
      // 잔여 세션 쿠키 제거 — 비활성/삭제 사용자로 관리 창이 열리지 않게
      req.session.destroy(() => undefined);
      jsonError(res, 401, 'api.error.unauthorized', req);
      return;
    }
    res.json({ admin: row.rows[0], locale: req.locale });
  } catch (err) {
    next(err);
  }
});

/** Crypto parity: access IP + server time for session meta bar */
authRouter.get('/session-info', requireAdmin, (req, res) => {
  const forwarded = req.headers['x-forwarded-for'];
  const cfIp = req.headers['cf-connecting-ip'];
  const ip =
    (typeof cfIp === 'string' ? cfIp.trim() : undefined) ||
    (typeof forwarded === 'string' ? forwarded.split(',')[0]?.trim() : undefined) ||
    req.socket.remoteAddress ||
    '';
  res.json({ ip, serverTime: new Date().toISOString() });
});

/** HQ: list / create / reset */
authRouter.get('/users', requireAdmin, requireHq, async (_req, res, next) => {
  try {
    const rows = await query(
      `SELECT id, email, name, role, active, totp_enabled, email_verified_at, last_login_at, created_at
       FROM admins ORDER BY created_at DESC`,
    );
    res.json({ items: rows.rows });
  } catch (e) {
    next(e);
  }
});

authRouter.post('/users', requireAdmin, requireHq, async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const name = String(req.body.name || '').trim() || email;
    const role = req.body.role === 'viewer' ? 'viewer' : 'hq';
    const password = String(req.body.password || '').trim() || Math.random().toString(36).slice(2, 10);
    const hash = await bcrypt.hash(password, 12);
    const row = await query(
      `INSERT INTO admins (email, password_hash, name, role, must_change_password)
       VALUES ($1, $2, $3, $4, TRUE) RETURNING id, email, name, role, active, totp_enabled`,
      [email, hash, name, role],
    );
    res.status(201).json({ user: row.rows[0], temporaryPassword: password });
  } catch (e) {
    next(e);
  }
});

authRouter.post('/users/:id/reset-password', requireAdmin, requireHq, async (req, res, next) => {
  try {
    const password = String(req.body.password || '').trim() || Math.random().toString(36).slice(2, 10);
    const hash = await bcrypt.hash(password, 12);
    await query(
      `UPDATE admins SET password_hash = $2, must_change_password = TRUE, updated_at = NOW() WHERE id = $1`,
      [req.params.id, hash],
    );
    res.json({ ok: true, temporaryPassword: password });
  } catch (e) {
    next(e);
  }
});

authRouter.post('/users/:id/reset-otp', requireAdmin, requireHq, async (req, res, next) => {
  try {
    await query(
      `UPDATE admins SET totp_secret = NULL, totp_enabled = FALSE, totp_pending_secret = NULL, updated_at = NOW()
       WHERE id = $1`,
      [req.params.id],
    );
    await writeAudit({
      eventType: 'admin.otp_reset',
      actorType: 'admin',
      actorId: req.session.adminId,
      detail: { target: req.params.id },
      ip: req.ip,
    });
    res.json({ ok: true, totpEnabled: false });
  } catch (e) {
    next(e);
  }
});

authRouter.patch('/users/:id', requireAdmin, requireHq, async (req, res, next) => {
  try {
    const { name, role, active } = req.body;
    const row = await query(
      `UPDATE admins SET
         name = COALESCE($2, name),
         role = COALESCE($3, role),
         active = COALESCE($4, active),
         updated_at = NOW()
       WHERE id = $1
       RETURNING id, email, name, role, active, totp_enabled`,
      [
        req.params.id,
        name ?? null,
        role === 'hq' || role === 'viewer' ? role : null,
        typeof active === 'boolean' ? active : null,
      ],
    );
    if (!row.rowCount) {
      jsonError(res, 404, 'api.error.notFound', req);
      return;
    }
    res.json({ user: row.rows[0] });
  } catch (e) {
    next(e);
  }
});
