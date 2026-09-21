import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { query } from '../db/pool.js';
import { config } from '../config.js';
import { requireApiKey, requireAdmin } from '../middleware/auth.js';
import { reissueInvoice } from '../services/invoice.js';
import { writeAudit } from '../services/crypto.js';
import { jsonError } from '../middleware/i18n.js';
import { t } from '../i18n/index.js';

export const invoicesRouter = Router();

invoicesRouter.get('/v1/invoices', requireApiKey, async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Number(req.query.offset) || 0;
    const rows = await query(
      `SELECT id, invoice_no, status, issued_at, currency, amount, asset, asset_amount,
              source_transaction_id, ticket_no, pdf_hash, created_at
       FROM invoices
       WHERE site_id = $1
       ORDER BY issued_at DESC
       LIMIT $2 OFFSET $3`,
      [req.siteAuth!.siteId, limit, offset],
    );
    res.json({ items: rows.rows, locale: req.locale });
  } catch (e) {
    next(e);
  }
});

invoicesRouter.get('/v1/invoices/:id', requireApiKey, async (req, res, next) => {
  try {
    const row = await query(
      `SELECT * FROM invoices WHERE id = $1 AND site_id = $2`,
      [req.params.id, req.siteAuth!.siteId],
    );
    if (!row.rowCount) {
      jsonError(res, 404, 'api.error.notFound', req);
      return;
    }
    const items = await query(`SELECT * FROM invoice_items WHERE invoice_id = $1 ORDER BY line_no`, [
      req.params.id,
    ]);
    res.json({ invoice: row.rows[0], items: items.rows, locale: req.locale });
  } catch (e) {
    next(e);
  }
});

async function sendPdf(opts: {
  invoiceId: string;
  siteId?: string;
  actorType: 'admin' | 'site';
  actorId: string;
  ip?: string;
  req: import('express').Request;
  res: import('express').Response;
}) {
  const row = await query(
    `SELECT * FROM invoices WHERE id = $1 AND ($2::uuid IS NULL OR site_id = $2)`,
    [opts.invoiceId, opts.siteId ?? null],
  );
  if (!row.rowCount) {
    jsonError(opts.res, 404, 'api.error.notFound', opts.req);
    return;
  }
  const inv = row.rows[0];
  if (!inv.pdf_path) {
    jsonError(opts.res, 404, 'api.error.pdfMissing', opts.req);
    return;
  }
  const abs = path.isAbsolute(inv.pdf_path)
    ? inv.pdf_path
    : path.join(config.pdfStorageDir, inv.pdf_path);
  if (!fs.existsSync(abs)) {
    jsonError(opts.res, 404, 'api.error.pdfFileMissing', opts.req);
    return;
  }
  await writeAudit({
    eventType: 'invoice.download',
    actorType: opts.actorType,
    actorId: opts.actorId,
    siteId: inv.site_id,
    invoiceId: inv.id,
    detail: { invoiceNo: inv.invoice_no },
    ip: opts.ip,
  });
  opts.res.setHeader('Content-Type', 'application/pdf');
  opts.res.setHeader('Content-Disposition', `attachment; filename="${inv.invoice_no}.pdf"`);
  fs.createReadStream(abs).pipe(opts.res);
}

invoicesRouter.get('/v1/invoices/:id/pdf', requireApiKey, async (req, res, next) => {
  try {
    await sendPdf({
      invoiceId: req.params.id,
      siteId: req.siteAuth!.siteId,
      actorType: 'site',
      actorId: req.siteAuth!.siteCode,
      ip: req.ip,
      req,
      res,
    });
  } catch (e) {
    next(e);
  }
});

invoicesRouter.post('/v1/invoices/:id/reissue', requireApiKey, async (req, res, next) => {
  try {
    const row = await query(`SELECT id FROM invoices WHERE id = $1 AND site_id = $2`, [
      req.params.id,
      req.siteAuth!.siteId,
    ]);
    if (!row.rowCount) {
      jsonError(res, 404, 'api.error.notFound', req);
      return;
    }
    const invoice = await reissueInvoice(req.params.id, `site:${req.siteAuth!.siteCode}`, req.ip);
    res.status(201).json({
      invoice: {
        id: invoice.id,
        invoiceNo: invoice.invoice_no,
        status: invoice.status,
        reissuedFromId: invoice.reissued_from_id,
      },
      locale: req.locale,
    });
  } catch (err) {
    const e = err as { status?: number; errorKey?: string; message?: string };
    if (e.status && e.status >= 400 && e.status < 500) {
      const key = e.errorKey || e.message || 'error.generic';
      res.status(e.status).json({
        error: t(req.locale ?? 'en', key),
        errorKey: key,
        locale: req.locale,
      });
      return;
    }
    next(err);
  }
});

invoicesRouter.get('/admin/api/invoices/:id/pdf', requireAdmin, async (req, res, next) => {
  try {
    await sendPdf({
      invoiceId: req.params.id,
      actorType: 'admin',
      actorId: req.session.adminId!,
      ip: req.ip,
      req,
      res,
    });
  } catch (e) {
    next(e);
  }
});

invoicesRouter.post('/admin/api/invoices/:id/reissue', requireAdmin, async (req, res, next) => {
  try {
    const invoice = await reissueInvoice(req.params.id, req.session.adminId!, req.ip);
    res.status(201).json({
      invoice: {
        id: invoice.id,
        invoiceNo: invoice.invoice_no,
        status: invoice.status,
        reissuedFromId: invoice.reissued_from_id,
      },
      locale: req.locale,
    });
  } catch (err) {
    const e = err as { status?: number; errorKey?: string; message?: string };
    if (e.status && e.status >= 400 && e.status < 500) {
      const key = e.errorKey || e.message || 'error.generic';
      res.status(e.status).json({
        error: t(req.locale ?? 'en', key),
        errorKey: key,
        locale: req.locale,
      });
      return;
    }
    next(err);
  }
});
