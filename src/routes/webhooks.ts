import { Router } from 'express';
import { requireApiKey, requireHmac } from '../middleware/auth.js';
import { issueFromWebhook, type CompletedWebhookBody } from '../services/invoice.js';
import { jsonError } from '../middleware/i18n.js';
import { t } from '../i18n/index.js';
import { resolvePdfLocale } from '../services/pdf.js';

export const webhookRouter = Router();

webhookRouter.post(
  '/transactions/completed',
  requireApiKey,
  requireHmac,
  async (req, res, next) => {
    try {
      const body = req.body as CompletedWebhookBody;
      const idempotencyKey = String(req.header('X-Idempotency-Key') || '').trim();

      if (!idempotencyKey) {
        jsonError(res, 400, 'api.error.missingIdempotency', req);
        return;
      }
      if (!body?.transactionId || !body?.amount || !body?.currency) {
        jsonError(res, 400, 'api.error.webhookRequiredFields', req);
        return;
      }
      if (!req.siteAuth) {
        jsonError(res, 401, 'api.error.unauthorized', req);
        return;
      }
      if (body.site && body.site !== req.siteAuth.siteCode) {
        jsonError(res, 400, 'api.error.siteMismatch', req);
        return;
      }
      if (body.event && body.event !== 'transaction.completed') {
        jsonError(res, 400, 'api.error.unsupportedEvent', req);
        return;
      }

      const result = await issueFromWebhook({
        siteId: req.siteAuth.siteId,
        siteCode: req.siteAuth.siteCode,
        idempotencyKey,
        body: { ...body, site: req.siteAuth.siteCode, event: 'transaction.completed' },
        actorType: 'site',
        ip: req.ip,
        // Bank remittance PDFs default to English; optional body.lang / pdfLang overrides
        locale: resolvePdfLocale(
          (body as { lang?: string; pdfLang?: string }).pdfLang ||
            (body as { lang?: string; pdfLang?: string }).lang ||
            'en',
        ),
      });

      res.status(result.idempotentReplay ? 200 : 201).json({
        idempotentReplay: result.idempotentReplay,
        locale: req.locale,
        invoice: {
          id: result.invoice.id,
          invoiceNo: result.invoice.invoice_no,
          status: result.invoice.status,
          issuedAt: result.invoice.issued_at,
          amount: result.invoice.amount,
          currency: result.invoice.currency,
          pdfHash: result.invoice.pdf_hash,
        },
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
  },
);
