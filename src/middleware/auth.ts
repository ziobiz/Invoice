import type { Request, Response, NextFunction } from 'express';
import { findActiveKeyByRaw, touchApiKey } from '../services/apiKeys.js';
import { hmacSha256, timingSafeEqualHex } from '../services/crypto.js';
import { config } from '../config.js';
import { jsonError } from './i18n.js';

export type SiteAuth = {
  apiKeyId: string;
  siteId: string;
  siteCode: string;
  hmacSecret: string;
};

declare global {
  namespace Express {
    interface Request {
      siteAuth?: SiteAuth;
      rawBody?: Buffer;
      admin?: { id: string; email: string; role: string; name: string };
    }
  }
}

declare module 'express-session' {
  interface SessionData {
    adminId?: string;
  }
}

export function captureRawBody(req: Request, _res: Response, buf: Buffer) {
  req.rawBody = buf;
}

export async function requireApiKey(req: Request, res: Response, next: NextFunction) {
  try {
    const apiKey = String(req.header('X-Api-Key') || '');
    if (!apiKey) {
      jsonError(res, 401, 'api.error.missingApiKey', req);
      return;
    }
    const row = await findActiveKeyByRaw(apiKey);
    if (!row || !row.site_active) {
      jsonError(res, 401, 'api.error.invalidApiKey', req);
      return;
    }
    req.siteAuth = {
      apiKeyId: row.id,
      siteId: row.site_id,
      siteCode: row.site_code,
      hmacSecret: row.hmac_secret,
    };
    await touchApiKey(row.id);
    next();
  } catch (err) {
    next(err);
  }
}

export function requireHmac(req: Request, res: Response, next: NextFunction) {
  try {
    const signature = String(req.header('X-Signature') || '')
      .toLowerCase()
      .replace(/^sha256=/, '')
      .trim();
    const tsHeader = req.header('X-Timestamp');

    if (!signature) {
      jsonError(res, 401, 'api.error.missingSignature', req);
      return;
    }
    if (!req.siteAuth) {
      jsonError(res, 401, 'api.error.unauthorized', req);
      return;
    }
    if (tsHeader) {
      const ts = Number(tsHeader);
      if (!Number.isFinite(ts)) {
        jsonError(res, 401, 'api.error.invalidSignature', req);
        return;
      }
      const skew = Math.abs(Date.now() / 1000 - ts);
      if (skew > config.webhookMaxSkewSeconds) {
        jsonError(res, 401, 'api.error.invalidSignature', req);
        return;
      }
    }

    const body = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body ?? {});
    const expected = hmacSha256(req.siteAuth.hmacSecret, body);
    if (!timingSafeEqualHex(expected, signature)) {
      jsonError(res, 401, 'api.error.invalidSignature', req);
      return;
    }
    next();
  } catch (err) {
    next(err);
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.adminId) {
    jsonError(res, 401, 'api.error.adminRequired', req);
    return;
  }
  next();
}

export function requireHq(req: Request, res: Response, next: NextFunction) {
  if (!req.admin || req.admin.role !== 'hq') {
    jsonError(res, 403, 'api.error.hqRequired', req);
    return;
  }
  next();
}
