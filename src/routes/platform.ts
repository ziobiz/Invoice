import { Router } from 'express';
import multer from 'multer';
import os from 'node:os';
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
import { config } from '../config.js';
import { SUPPORTED_LOCALES } from '../i18n/index.js';

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

    const [invTot, sitesTot, bySite, bySiteCur, recent, statusCounts] = await Promise.all([
      query<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM invoices WHERE deleted_at IS NULL`,
      ),
      query<{ c: string }>(`SELECT COUNT(*)::text AS c FROM sites WHERE active`),
      query<{
        id: string;
        code: string;
        name: string;
        active: boolean;
        issued_count: string;
        reissued_count: string;
        void_count: string;
        total_count: string;
        last_issued_at: Date | null;
      }>(
        `SELECT s.id, s.code, s.name, s.active,
                COUNT(i.id) FILTER (WHERE i.status = 'issued' AND i.deleted_at IS NULL)::text AS issued_count,
                COUNT(i.id) FILTER (WHERE i.status = 'reissued' AND i.deleted_at IS NULL)::text AS reissued_count,
                COUNT(i.id) FILTER (WHERE i.status = 'void' OR i.deleted_at IS NOT NULL)::text AS void_count,
                COUNT(i.id)::text AS total_count,
                MAX(i.issued_at) FILTER (WHERE i.status = 'issued' AND i.deleted_at IS NULL) AS last_issued_at
         FROM sites s
         LEFT JOIN invoices i ON i.site_id = s.id
         GROUP BY s.id
         ORDER BY s.code`,
      ),
      query<{
        site_code: string;
        currency: string;
        issued_count: string;
        issued_amount: string;
      }>(
        `SELECT s.code AS site_code, i.currency,
                COUNT(*)::text AS issued_count,
                COALESCE(SUM(i.amount), 0)::text AS issued_amount
         FROM invoices i
         JOIN sites s ON s.id = i.site_id
         WHERE i.status = 'issued' AND i.deleted_at IS NULL
         GROUP BY s.code, i.currency
         ORDER BY s.code, i.currency`,
      ),
      query<{
        id: string;
        invoice_no: string;
        issued_at: Date;
        currency: string;
        amount: string;
        status: string;
        site_code: string;
        buyer_code: string | null;
        seller_code: string | null;
        ticket_no: string | null;
      }>(
        `SELECT i.id, i.invoice_no, i.issued_at, i.currency, i.amount::text AS amount, i.status,
                s.code AS site_code,
                i.buyer_snapshot->>'code' AS buyer_code,
                i.seller_snapshot->>'code' AS seller_code,
                i.ticket_no
         FROM invoices i
         JOIN sites s ON s.id = i.site_id
         WHERE i.deleted_at IS NULL
         ORDER BY i.issued_at DESC
         LIMIT 12`,
      ),
      query<{ status: string; c: string }>(
        `SELECT status, COUNT(*)::text AS c
         FROM invoices
         WHERE deleted_at IS NULL
         GROUP BY status`,
      ),
    ]);

    const amountByCurrency = await query<{ currency: string; amount: string; c: string }>(
      `SELECT currency,
              COALESCE(SUM(amount), 0)::text AS amount,
              COUNT(*)::text AS c
       FROM invoices
       WHERE status = 'issued' AND deleted_at IS NULL
       GROUP BY currency
       ORDER BY currency`,
    );

    const amountsBySite: Record<
      string,
      Array<{ currency: string; count: number; amount: string }>
    > = {};
    for (const row of bySiteCur.rows) {
      if (!amountsBySite[row.site_code]) amountsBySite[row.site_code] = [];
      amountsBySite[row.site_code].push({
        currency: row.currency,
        count: Number(row.issued_count),
        amount: row.issued_amount,
      });
    }

    const statusMap: Record<string, number> = {};
    for (const r of statusCounts.rows) statusMap[r.status] = Number(r.c);

    const mem = process.memoryUsage();
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
        invoices: Number(invTot.rows[0]?.c || 0),
        issued: statusMap.issued || 0,
        reissued: statusMap.reissued || 0,
        void: statusMap.void || 0,
        activeSites: Number(sitesTot.rows[0]?.c || 0),
        amounts: amountByCurrency.rows.map((r) => ({
          currency: r.currency,
          amount: r.amount,
          count: Number(r.c),
        })),
      },
      sites: bySite.rows.map((s) => ({
        id: s.id,
        code: s.code,
        name: s.name,
        active: s.active,
        issuedCount: Number(s.issued_count),
        reissuedCount: Number(s.reissued_count),
        voidCount: Number(s.void_count),
        totalCount: Number(s.total_count),
        lastIssuedAt: s.last_issued_at,
        amounts: amountsBySite[s.code] || [],
      })),
      recent: recent.rows.map((r) => ({
        id: r.id,
        invoiceNo: r.invoice_no,
        issuedAt: r.issued_at,
        currency: r.currency,
        amount: r.amount,
        status: r.status,
        siteCode: r.site_code,
        buyerCode: r.buyer_code,
        sellerCode: r.seller_code,
        ticketNo: r.ticket_no,
      })),
      server: {
        service: 'invoice-service',
        ok: true,
        node: process.version,
        env: config.env,
        pid: process.pid,
        uptimeSec: Math.floor(process.uptime()),
        memoryMb: Math.round(mem.rss / 1024 / 1024),
        heapMb: Math.round(mem.heapUsed / 1024 / 1024),
        host: os.hostname(),
        platform: `${os.type()} ${os.release()}`,
        publicBaseUrl: config.publicBaseUrl,
        port: config.port,
        invoiceTz: config.invoiceTz,
        pdfStorageDir: config.pdfStorageDir,
        locales: SUPPORTED_LOCALES,
        now: new Date().toISOString(),
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
