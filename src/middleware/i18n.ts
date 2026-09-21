import type { Request, Response, NextFunction } from 'express';
import { localeFromRequest, t, type Locale, SUPPORTED_LOCALES } from '../i18n/index.js';

declare global {
  namespace Express {
    interface Request {
      locale?: Locale;
      t?: (key: string, vars?: Record<string, string | number>) => string;
    }
  }
}

export function i18nMiddleware(req: Request, _res: Response, next: NextFunction) {
  const locale = localeFromRequest({
    acceptLanguage: req.header('Accept-Language'),
    langQuery: typeof req.query.lang === 'string' ? req.query.lang : null,
  });
  req.locale = locale;
  req.t = (key, vars) => t(locale, key, vars);
  next();
}

export function jsonError(res: Response, status: number, key: string, req?: Request) {
  const locale = req?.locale ?? 'en';
  res.status(status).json({
    error: t(locale, key),
    errorKey: key,
    locale,
  });
}

export { SUPPORTED_LOCALES };
