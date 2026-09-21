import { Router } from 'express';
import multer from 'multer';
import { requireAdmin, requireHq } from '../middleware/auth.js';
import {
  fetchCloudflareStatus,
  getPlatformConfig,
  isSmtpConfigured,
  maskSecrets,
  readSslStatus,
  savePlatformConfig,
  sendOtpEmail,
} from '../services/platform.js';
import { saveBrandingAsset, type BrandAsset } from '../services/branding.js';
import { writeAudit } from '../services/crypto.js';
import { query } from '../db/pool.js';

export const platformRouter = Router();
platformRouter.use(requireAdmin);

const brandUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

platformRouter.get('/', async (_req, res, next) => {
  try {
    const cfg = await getPlatformConfig();
    const ssl = await readSslStatus(cfg.sslCertPath);
    const cf = await fetchCloudflareStatus();
    res.json({
      config: maskSecrets(cfg),
      ssl,
      cloudflare: cf,
      smtpConfigured: isSmtpConfigured(cfg),
    });
  } catch (e) {
    next(e);
  }
});

platformRouter.put('/', requireHq, async (req, res, next) => {
  try {
    const nextCfg = await savePlatformConfig(req.body || {});
    await writeAudit({
      eventType: 'platform.updated',
      actorType: 'admin',
      actorId: req.session.adminId,
      detail: { keys: Object.keys(req.body || {}) },
      ip: req.ip,
    });
    const ssl = await readSslStatus(nextCfg.sslCertPath);
    const cf = await fetchCloudflareStatus();
    res.json({
      config: maskSecrets(nextCfg),
      ssl,
      cloudflare: cf,
      smtpConfigured: isSmtpConfigured(nextCfg),
    });
  } catch (e) {
    next(e);
  }
});

function brandUploadRoute(asset: BrandAsset) {
  return async (
    req: import('express').Request,
    res: import('express').Response,
    next: import('express').NextFunction,
  ) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: 'file required' });
        return;
      }
      const cfg = await saveBrandingAsset(asset, {
        buffer: req.file.buffer,
        originalname: req.file.originalname,
      });
      await writeAudit({
        eventType: 'platform.branding.upload',
        actorType: 'admin',
        actorId: req.session.adminId,
        detail: { asset, filename: req.file.originalname },
        ip: req.ip,
      });
      res.json({ config: maskSecrets(cfg), asset });
    } catch (e) {
      next(e);
    }
  };
}

platformRouter.post('/branding/logo', requireHq, brandUpload.single('file'), brandUploadRoute('logo'));
platformRouter.post(
  '/branding/auth-logo',
  requireHq,
  brandUpload.single('file'),
  brandUploadRoute('auth-logo'),
);
platformRouter.post(
  '/branding/favicon',
  requireHq,
  brandUpload.single('file'),
  brandUploadRoute('favicon'),
);
platformRouter.post(
  '/branding/background',
  requireHq,
  brandUpload.single('file'),
  brandUploadRoute('background'),
);
platformRouter.post('/branding/og', requireHq, brandUpload.single('file'), brandUploadRoute('og'));

platformRouter.post('/email/test', requireHq, async (req, res, next) => {
  try {
    const to = String(req.body.to || '').trim();
    if (!to) {
      res.status(400).json({ error: 'to required' });
      return;
    }
    const cfg = await getPlatformConfig();
    if (!isSmtpConfigured(cfg)) {
      res.status(400).json({ error: 'SMTP not configured' });
      return;
    }
    await sendOtpEmail(to, 'Test', '000000', cfg.otpExpireMinutes);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

platformRouter.get('/dashboard', async (_req, res, next) => {
  try {
    const cfg = await getPlatformConfig();
    const ssl = await readSslStatus(cfg.sslCertPath);
    const cf = await fetchCloudflareStatus();
    const inv = await query<{ c: string }>(`SELECT COUNT(*)::text AS c FROM invoices`);
    const sites = await query<{ c: string }>(`SELECT COUNT(*)::text AS c FROM sites WHERE active`);
    res.json({
      siteName: cfg.siteName,
      publicDomain: cfg.publicDomain,
      originIp: cfg.originIp,
      ssl,
      cloudflare: cf,
      turnstileEnabled: cfg.turnstileEnabled && Boolean(cfg.turnstileSiteKey),
      otpEnabled: cfg.otpEnabled,
      emailOtpEnabled: cfg.emailOtpEnabled,
      smtpConfigured: isSmtpConfigured(cfg),
      stats: {
        invoices: Number(inv.rows[0]?.c || 0),
        activeSites: Number(sites.rows[0]?.c || 0),
      },
      checklist: [
        { id: 'dns', labelKey: 'dash.cf.dns', done: true },
        { id: 'proxy', labelKey: 'dash.cf.proxy', done: Boolean(cf.configured && cf.records?.length) },
        {
          id: 'sslFull',
          labelKey: 'dash.cf.sslFull',
          done: ssl.status === 'ok' || ssl.status === 'expiring',
        },
        {
          id: 'turnstile',
          labelKey: 'dash.cf.turnstile',
          done: cfg.turnstileEnabled && Boolean(cfg.turnstileSiteKey),
        },
        { id: 'smtp', labelKey: 'dash.cf.smtp', done: isSmtpConfigured(cfg) },
      ],
    });
  } catch (e) {
    next(e);
  }
});
