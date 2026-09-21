import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { query } from '../db/pool.js';
import { config } from '../config.js';
import { requireApiKey, requireAdmin } from '../middleware/auth.js';
import { reissueInvoice } from '../services/invoice.js';
import { generateInvoicePdf } from '../services/pdf.js';
import { writeAudit, randomToken } from '../services/crypto.js';
import { jsonError } from '../middleware/i18n.js';
import { t } from '../i18n/index.js';
import { sealConfigFromSite, pdfDefaultsFromSite, type SiteSealRow } from '../services/seal.js';
import { resolvePdfLocale } from '../services/pdf.js';

export const invoicesRouter = Router();

function verifyUrlFor(token: string): string {
  const base = (config.publicBaseUrl || '').replace(/\/$/, '') || 'http://localhost:3100';
  return `${base}/verify/${encodeURIComponent(token)}`;
}

async function ensureVerifyToken(invoiceId: string, existing?: string | null): Promise<string> {
  if (existing && String(existing).trim()) return String(existing).trim();
  const token = randomToken(24);
  await query(`UPDATE invoices SET verify_token = $2 WHERE id = $1 AND (verify_token IS NULL OR verify_token = '')`, [
    invoiceId,
    token,
  ]);
  const row = await query<{ verify_token: string }>(`SELECT verify_token FROM invoices WHERE id = $1`, [
    invoiceId,
  ]);
  return row.rows[0]?.verify_token || token;
}

async function refreshInvoicePdf(
  inv: Record<string, unknown>,
  locale: import('../i18n/index.js').Locale,
  actorId?: string | null,
) {
  const site = await query<SiteSealRow>(
    `SELECT * FROM sites WHERE id = $1`,
    [inv.site_id],
  );
  const siteCode = site.rows[0]?.code || 'site';
  const seller = inv.seller_snapshot as import('../services/pdf.js').PartySnap;
  const buyer = inv.buyer_snapshot as import('../services/pdf.js').PartySnap;
  const product = (inv.product_snapshot || {}) as {
    name?: string;
    code?: string;
    description?: string;
    unit?: string;
    remark?: string | null;
  };
  const seal = site.rows[0]
    ? sealConfigFromSite(site.rows[0], seller?.legal_name)
    : null;
  const sitePdf = pdfDefaultsFromSite(site.rows[0]);
  const verifyToken = await ensureVerifyToken(String(inv.id), inv.verify_token as string | null);
  const items = await query(
    `SELECT * FROM invoice_items WHERE invoice_id = $1 ORDER BY line_no`,
    [inv.id],
  );
  const remarkText = (() => {
    const fromProduct = String(product.remark || '').trim();
    if (fromProduct) return fromProduct;
    const ticket = String(inv.ticket_no || '').trim();
    if (ticket && !ticket.startsWith('SIM-')) return ticket;
    return '';
  })();
  const lineItems =
    items.rowCount && items.rows.length
      ? items.rows.map((r) => ({
          item: String(product.name || r.product_code || ''),
          description: String(r.description || product.description || product.name || ''),
          unitPrice: String(r.unit_price),
          quantity: String(r.quantity),
          amount: String(r.amount),
          unit: String(r.unit || inv.asset || product.unit || 'EA'),
          remark: remarkText,
        }))
      : [
          {
            item: product.name || product.code || '',
            description: product.description || product.name || '',
            unitPrice: String(inv.amount),
            quantity: inv.asset_amount != null ? String(inv.asset_amount) : '1',
            amount: String(inv.amount),
            unit: String(inv.asset || product.unit || 'EA'),
            remark: remarkText,
          },
        ];

  const pdf = await generateInvoicePdf({
    invoiceNo: String(inv.invoice_no),
    issuedAt: new Date(String(inv.issued_at)),
    currency: String(inv.currency),
    amount: String(inv.amount),
    asset: inv.asset != null ? String(inv.asset) : null,
    assetAmount: inv.asset_amount != null ? String(inv.asset_amount) : null,
    ticketNo: inv.ticket_no != null ? String(inv.ticket_no) : null,
    sourceTransactionId: String(inv.source_transaction_id || ''),
    sourceSite: siteCode,
    memo: inv.memo != null ? String(inv.memo) : null,
    seller,
    buyer,
    lineItems,
    locale,
    seal,
    sitePdf,
    verifyUrl: verifyUrlFor(verifyToken),
  });
  await query(
    `UPDATE invoices SET pdf_path = $2, pdf_hash = $3, pdf_regenerated_at = NOW(), updated_at = NOW(),
       last_actor_id = COALESCE($4::uuid, last_actor_id)
     WHERE id = $1`,
    [inv.id, pdf.relativePath, pdf.pdfHash, actorId ?? null],
  );
  return pdf;
}

async function sendPdf(opts: {
  invoiceId: string;
  siteId?: string;
  actorType: 'admin' | 'site';
  actorId: string;
  ip?: string;
  req: import('express').Request;
  res: import('express').Response;
  /** Force regenerate even if file exists */
  forceRefresh?: boolean;
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
  // PDF language is independent of admin UI language — default English for banks
  const locale = resolvePdfLocale(
    String(opts.req.query.pdfLang || opts.req.query.lang || 'en'),
  );
  const inline =
    String(opts.req.query.inline || opts.req.query.preview || '') === '1' ||
    String(opts.req.query.disposition || '') === 'inline';
  let abs: string;
  try {
    const pdf = await refreshInvoicePdf(inv, locale);
    abs = pdf.pdfPath;
  } catch {
    if (!inv.pdf_path) {
      jsonError(opts.res, 404, 'api.error.pdfMissing', opts.req);
      return;
    }
    abs = path.isAbsolute(inv.pdf_path)
      ? inv.pdf_path
      : path.join(config.pdfStorageDir, inv.pdf_path);
    if (!fs.existsSync(abs)) {
      jsonError(opts.res, 404, 'api.error.pdfFileMissing', opts.req);
      return;
    }
  }
  await writeAudit({
    eventType: inline ? 'invoice.preview' : 'invoice.download',
    actorType: opts.actorType,
    actorId: opts.actorId,
    siteId: inv.site_id,
    invoiceId: inv.id,
    detail: { invoiceNo: inv.invoice_no, locale, inline },
    ip: opts.ip,
  });
  opts.res.setHeader('Content-Type', 'application/pdf');
  opts.res.setHeader(
    'Content-Disposition',
    `${inline ? 'inline' : 'attachment'}; filename="${inv.invoice_no}.pdf"`,
  );
  fs.createReadStream(abs).pipe(opts.res);
}

invoicesRouter.get('/v1/invoices', requireApiKey, async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Number(req.query.offset) || 0;
    const kindRaw = String(req.query.kind || 'all').toLowerCase();
    const kind =
      kindRaw === 'simulator' || kindRaw === 'sim'
        ? 'simulator'
        : kindRaw === 'sandbox'
          ? 'sandbox'
          : kindRaw === 'live'
            ? 'live'
            : 'all';
    const from = req.query.from ? String(req.query.from) : null;
    const to = req.query.to ? String(req.query.to) : null;
    const buyer = req.query.buyer ? String(req.query.buyer) : null;
    const rows = await query(
      `SELECT id, invoice_no, status, issued_at, currency, amount, asset, asset_amount,
              source_transaction_id, ticket_no, buyer_ref, memo, pdf_hash, created_at,
              CASE
                WHEN memo IS NOT NULL AND memo LIKE '[SIMULATOR]%' THEN 'simulator'
                WHEN memo IS NOT NULL AND memo LIKE '[SANDBOX]%' THEN 'sandbox'
                ELSE 'live'
              END AS invoice_kind
       FROM invoices
       WHERE site_id = $1
         AND ($2::text = 'all'
           OR ($2::text = 'simulator' AND memo IS NOT NULL AND memo LIKE '[SIMULATOR]%')
           OR ($2::text = 'sandbox' AND memo IS NOT NULL AND memo LIKE '[SANDBOX]%')
           OR ($2::text = 'live' AND (memo IS NULL OR (memo NOT LIKE '[SIMULATOR]%' AND memo NOT LIKE '[SANDBOX]%'))))
         AND ($3::text IS NULL OR issued_at >= $3::date)
         AND ($4::text IS NULL OR issued_at < ($4::date + interval '1 day'))
         AND ($5::text IS NULL OR buyer_ref = ANY(string_to_array($5, ',')))
       ORDER BY issued_at DESC
       LIMIT $6 OFFSET $7`,
      [req.siteAuth!.siteId, kind, from, to, buyer, limit, offset],
    );
    res.json({ items: rows.rows, locale: req.locale, kind });
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

/** Rebuild PDF file only (same invoice no) — for layout/seal/lang refresh */
invoicesRouter.post('/admin/api/invoices/:id/regenerate-pdf', requireAdmin, async (req, res, next) => {
  try {
    const row = await query(`SELECT * FROM invoices WHERE id = $1`, [req.params.id]);
    if (!row.rowCount) {
      jsonError(res, 404, 'api.error.notFound', req);
      return;
    }
    const locale = resolvePdfLocale(String(req.query.pdfLang || req.body?.pdfLang || req.body?.lang || 'en'));
    const pdf = await refreshInvoicePdf(row.rows[0], locale, req.session.adminId);
    await writeAudit({
      eventType: 'invoice.pdf.regenerated',
      actorType: 'admin',
      actorId: req.session.adminId!,
      siteId: row.rows[0].site_id,
      invoiceId: row.rows[0].id,
      detail: { invoiceNo: row.rows[0].invoice_no, locale },
      ip: req.ip,
    });
    res.json({
      ok: true,
      invoiceNo: row.rows[0].invoice_no,
      pdfPath: pdf.relativePath,
      pdfHash: pdf.pdfHash,
      locale,
      pdfRegeneratedAt: new Date().toISOString(),
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
