import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import { config } from './config.js';
import { pool, query } from './db/pool.js';
import { captureRawBody } from './middleware/auth.js';
import { i18nMiddleware } from './middleware/i18n.js';
import { authRouter } from './routes/auth.js';
import { adminRouter } from './routes/admin.js';
import { webhookRouter } from './routes/webhooks.js';
import { invoicesRouter } from './routes/invoices.js';
import { platformRouter } from './routes/platform.js';
import { brandingRouter } from './routes/branding.js';
import { verifyRouter } from './routes/verify.js';
import { buildAdminHtml } from './services/branding.js';
import { t, SUPPORTED_LOCALES } from './i18n/index.js';
import { startInvoiceRetentionScheduler } from './services/retention.js';

fs.mkdirSync(config.pdfStorageDir, { recursive: true });
fs.mkdirSync(path.resolve(process.env.UPLOAD_DIR ?? './uploads', 'branding'), { recursive: true });

const app = express();
const PgSession = connectPgSimple(session);

app.set('trust proxy', 1);

app.use(
  express.json({
    verify: captureRawBody,
    limit: '1mb',
  }),
);

app.use(i18nMiddleware);

app.use(
  session({
    store: new PgSession({
      pool,
      tableName: 'session',
      createTableIfMissing: true,
    }),
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.env === 'production' && config.publicBaseUrl.startsWith('https'),
      // 브라우저 세션 쿠키만 — 종료 후 재접속 시 로그인 없이 관리 창이 열리지 않음 (Crypto localStorage 잔여 사고 방지)
    },
  }),
);

app.use(async (req, _res, next) => {
  if (req.session?.adminId) {
    try {
      const row = await query<{ id: string; email: string; name: string; role: string }>(
        `SELECT id, email, name, role FROM admins WHERE id = $1 AND active = TRUE`,
        [req.session.adminId],
      );
      if (row.rowCount) req.admin = row.rows[0];
    } catch {
      /* ignore */
    }
  }
  next();
});

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'invoice-service',
    ts: new Date().toISOString(),
    locales: SUPPORTED_LOCALES,
  });
});

app.use('/api/branding', brandingRouter);
app.use('/admin/api/auth', authRouter);
app.use('/admin/api/platform', platformRouter);
app.use('/admin/api', adminRouter);
app.use('/v1/webhooks', webhookRouter);
app.use('/verify', verifyRouter);
app.use(invoicesRouter);

const publicDir = path.join(process.cwd(), 'public');
app.use(express.static(publicDir));

async function sendBrandedAdmin(_req: express.Request, res: express.Response, next: express.NextFunction) {
  try {
    const template = fs.readFileSync(path.join(publicDir, 'admin.html'), 'utf8');
    const html = await buildAdminHtml(template);
    res.type('html').send(html);
  } catch (e) {
    next(e);
  }
}

app.get('/admin', sendBrandedAdmin);
app.get('/', (_req, res) => {
  res.redirect('/admin');
});

app.use(
  (
    err: Error & { status?: number; code?: string; errorKey?: string },
    req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error(err);
    const locale = req.locale ?? 'en';
    if (err.code === '23505') {
      res.status(409).json({
        error: t(locale, 'api.error.duplicate'),
        errorKey: 'api.error.duplicate',
        locale,
      });
      return;
    }
    const key = err.errorKey || (err.status && err.status < 500 ? err.message : 'api.error.internal');
    const isI18nKey = key.startsWith('api.') || key.startsWith('error.');
    res.status(err.status || 500).json({
      error: t(locale, isI18nKey ? key : 'api.error.internal'),
      errorKey: key,
      locale,
    });
  },
);

app.listen(config.port, () => {
  console.log(`Invoice Service listening on :${config.port}`);
  startInvoiceRetentionScheduler();
});
