import { Router } from 'express';
import { query } from '../db/pool.js';
import { t, resolveLocale, type Locale } from '../i18n/index.js';

export const verifyRouter = Router();

type VerifyRow = {
  id: string;
  invoice_no: string;
  status: string;
  amount: string | number;
  seller_snapshot: {
    legal_name?: string;
    trade_name?: string;
    code?: string;
    country?: string;
    address?: string;
  };
  buyer_snapshot: {
    legal_name?: string;
    trade_name?: string;
    code?: string;
    country?: string;
    address?: string;
  };
  verify_token: string;
  deleted_at?: Date | null;
};

async function loadByToken(token: string): Promise<VerifyRow | null> {
  const row = await query<VerifyRow>(
    `SELECT i.id, i.invoice_no, i.status, i.amount,
            i.seller_snapshot, i.buyer_snapshot, i.verify_token, i.deleted_at
     FROM invoices i
     WHERE i.verify_token = $1`,
    [token],
  );
  return row.rows[0] ?? null;
}

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Last 3 digits of the integer amount (e.g. 1966629.00 → 629, not 000). */
function amountTail3(amount: string | number): string {
  const raw = String(amount ?? '').trim().replace(/,/g, '');
  if (!raw) return '—';
  // Prefer numeric parse so fractional ".00" does not become trailing digits
  const n = Number(raw);
  if (Number.isFinite(n)) {
    const intPart = Math.trunc(Math.abs(n)).toString();
    return intPart.slice(-3).padStart(3, '0');
  }
  const beforeDot = raw.split('.')[0] ?? raw;
  const digits = beforeDot.replace(/[^\d]/g, '');
  if (!digits) return '—';
  return digits.slice(-3).padStart(3, '0');
}

/** City from free-text address (no street); country from party.country */
function extractCity(address?: string | null, country?: string | null): string | null {
  const addr = String(address || '').trim();
  if (!addr) return null;
  const ctry = String(country || '').trim();
  const parts = addr
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.length) return null;

  const looksLikeCountry = (s: string) => {
    const lower = s.toLowerCase();
    if (ctry) {
      const c = ctry.toLowerCase();
      if (lower === c || lower.includes(c) || c.includes(lower)) return true;
    }
    return /^(republic of|kingdom of|united states|usa|u\.s\.a\.?)\b/i.test(s) ||
      /\b(korea|japan|china|thailand|singapore|vietnam|indonesia|malaysia|philippines|taiwan)\b/i.test(
        s,
      );
  };

  const segs = [...parts];
  while (segs.length && looksLikeCountry(segs[segs.length - 1]!)) {
    segs.pop();
  }
  const city = segs.length ? segs[segs.length - 1]! : null;
  if (!city || looksLikeCountry(city)) return null;
  // Skip obvious street/building-only leftovers (numbers / floors)
  if (/^\d/.test(city) || /\b(floor|fl\.|building|bldg|tower|road|ro|street|st\.|ave)\b/i.test(city)) {
    return segs.length >= 2 ? segs[segs.length - 2]! : null;
  }
  return city;
}

function partyLines(p?: {
  legal_name?: string;
  trade_name?: string;
  code?: string;
  country?: string;
  address?: string;
} | null): { name: string; detail: string } {
  const name = p?.legal_name || p?.trade_name || p?.code || '—';
  const city = extractCity(p?.address, p?.country);
  const country = String(p?.country || '').trim() || null;
  const detail = [city, country].filter(Boolean).join(', ');
  return { name, detail };
}

verifyRouter.get('/:token', async (req, res, next) => {
  try {
    const token = String(req.params.token || '').trim();
    if (!token || token.length < 16) {
      res.status(404).type('html').send(notFoundPage(req.locale ?? 'en'));
      return;
    }
    const inv = await loadByToken(token);
    if (!inv || inv.status === 'void' || inv.deleted_at) {
      res.status(404).type('html').send(notFoundPage(req.locale ?? 'en'));
      return;
    }
    const locale = resolveLocale(String(req.query.lang || req.locale || 'en')) as Locale;
    const seller = partyLines(inv.seller_snapshot);
    const buyer = partyLines(inv.buyer_snapshot);
    const tail = amountTail3(inv.amount);
    res.type('html').send(`<!DOCTYPE html>
<html lang="${esc(locale)}">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${esc(t(locale, 'verify.title'))}</title>
  <style>
    :root { color-scheme: light; }
    body { font-family: system-ui, -apple-system, sans-serif; margin: 0; background: #f1f5f9; color: #0f172a; }
    .wrap { max-width: 420px; margin: 2.5rem auto; padding: 0 1rem; }
    .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 1.35rem 1.25rem; box-shadow: 0 1px 2px rgba(15,23,42,.04); }
    .ok { display:inline-block; background:#ecfdf5; color:#065f46; border:1px solid #a7f3d0;
          border-radius:999px; padding:.22rem .7rem; font-size:.72rem; font-weight:700; letter-spacing:.02em; margin-bottom:.9rem; }
    h1 { font-size: 1.15rem; margin: 0 0 .4rem; }
    .hint { color: #64748b; font-size: .86rem; margin: 0 0 1.1rem; line-height: 1.45; }
    .row { display:flex; flex-direction:column; gap:.2rem; padding:.7rem 0; border-top:1px solid #f1f5f9; }
    .row:first-of-type { border-top:0; padding-top:0; }
    .lab { font-size:.72rem; color:#64748b; text-transform:uppercase; letter-spacing:.04em; }
    .val { font-size:1.05rem; font-weight:650; word-break:break-word; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    .sub { font-size:.82rem; color:#475569; margin-top:.15rem; line-height:1.35; }
    footer { margin-top: 1rem; color:#94a3b8; font-size:.72rem; text-align:center; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="ok">${esc(t(locale, 'verify.badge'))}</div>
      <h1>${esc(t(locale, 'verify.title'))}</h1>
      <p class="hint">${esc(t(locale, 'verify.hint'))}</p>
      <div class="row">
        <div class="lab">${esc(t(locale, 'verify.piNo'))}</div>
        <div class="val mono">${esc(inv.invoice_no)}</div>
      </div>
      <div class="row">
        <div class="lab">${esc(t(locale, 'verify.amountTail'))}</div>
        <div class="val mono">…${esc(tail)}</div>
      </div>
      <div class="row">
        <div class="lab">${esc(t(locale, 'verify.seller'))}</div>
        <div class="val">${esc(seller.name)}</div>
        ${seller.detail ? `<div class="sub">${esc(seller.detail)}</div>` : ''}
      </div>
      <div class="row">
        <div class="lab">${esc(t(locale, 'verify.buyer'))}</div>
        <div class="val">${esc(buyer.name)}</div>
        ${buyer.detail ? `<div class="sub">${esc(buyer.detail)}</div>` : ''}
      </div>
    </div>
    <footer>${esc(t(locale, 'verify.footer'))}</footer>
  </div>
</body>
</html>`);
  } catch (e) {
    next(e);
  }
});

function notFoundPage(localeRaw: string) {
  const locale = resolveLocale(localeRaw) as Locale;
  return `<!DOCTYPE html><html lang="${esc(locale)}"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${esc(t(locale, 'verify.notFoundTitle'))}</title>
<style>body{font-family:system-ui,sans-serif;max-width:420px;margin:3rem auto;padding:0 1rem;color:#0f172a}
.card{border:1px solid #e2e8f0;border-radius:12px;padding:1.25rem;background:#fff}</style></head>
<body><div class="card"><h1>${esc(t(locale, 'verify.notFoundTitle'))}</h1>
<p>${esc(t(locale, 'verify.notFoundBody'))}</p></div></body></html>`;
}
