import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { config } from '../config.js';
import { t, type Locale, DEFAULT_LOCALE, resolveLocale } from '../i18n/index.js';
import type { SiteSealConfig, SitePdfDefaults } from './seal.js';

export type PartySnap = {
  code: string;
  legal_name: string;
  trade_name?: string | null;
  country?: string | null;
  address?: string | null;
  tax_id?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  bank_info?: string | null;
  /** Buyer contact / seller signatory — preferred over site seal fallback */
  signatory_name?: string | null;
  signatory_title?: string | null;
};

export type LineItemInput = {
  item?: string;
  description: string;
  unitPrice: string | number;
  quantity: string | number;
  amount: string | number;
  unit?: string;
  remark?: string;
  /** When set (including ''), overrides unit text; '' = quantity number only */
  unitLabel?: string | null;
  /** Hide unit price & unit columns as "—" (amount still shown) */
  hideUnitPrice?: boolean;
};

export type InvoicePdfInput = {
  invoiceNo: string;
  issuedAt: Date;
  currency: string;
  amount: string;
  asset?: string | null;
  assetAmount?: string | null;
  ticketNo?: string | null;
  sourceTransactionId: string;
  sourceSite: string;
  memo?: string | null;
  seller: PartySnap;
  buyer: PartySnap;
  lineDescription?: string;
  quantity?: string;
  unit?: string;
  unitPrice?: string;
  lineItems?: LineItemInput[];
  originOfGoods?: string;
  termsOfPrice?: string;
  termsOfPayment?: string;
  timeOfDelivery?: string;
  paymentDueText?: string;
  locale?: Locale;
  seal?: SiteSealConfig | null;
  sitePdf?: SitePdfDefaults | null;
  /** Public authenticity URL encoded in bottom-right QR */
  verifyUrl?: string | null;
};

/** PDF labels default to English (bank remittance). UI language must not override this. */
export function resolvePdfLocale(input?: string | null): Locale {
  if (!input || !String(input).trim()) return DEFAULT_LOCALE;
  return resolveLocale(input);
}

const COLORS = {
  ink: '#000000',
  muted: '#4b5563',
  seller: '#0f3d68',
  buyer: '#1d4ed8',
  amount: '#b91c1c',
  headerBg: '#0f3d68',
  headerFg: '#ffffff',
  rowAlt: '#f8fafc',
  border: '#94a3b8',
  line: '#cbd5e1',
  notice: '#6b7280',
};

function formatSignatoryLine(name: string, title: string): string {
  const n = String(name || '').trim() || '—';
  const ttl = String(title || '').trim() || 'CEO';
  const withHonorific = /^(mr|ms|mrs|miss|dr)\.?\s/i.test(n) ? n : `Mr. ${n}`;
  return `${withHonorific} / ${ttl}`;
}

/**
 * Messrs block: company on line 1, "Mr. Name / Title" on line 2.
 * Prefer party.signatory_*; then legacy trade_name / legal_name "COMPANY / Mr. NAME / TITLE".
 */
function resolveMessrsLines(buyer: PartySnap): { company: string; personLine: string | null } {
  const legal = String(buyer.legal_name || '').trim();
  const trade = String(buyer.trade_name || '').trim();
  const company = legal || trade || '—';
  const partyName = String(buyer.signatory_name || '').trim();
  if (partyName) {
    return {
      company: legal || trade || '—',
      personLine: formatSignatoryLine(partyName, buyer.signatory_title || 'DIRECTOR'),
    };
  }
  if (!legal && !trade) return { company: '—', personLine: null };

  const slashParts = legal
    .split(/\s*\/\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (slashParts.length >= 3) {
    const companyFromSlash = slashParts[0]!;
    const name = slashParts[1]!;
    const title = slashParts.slice(2).join(' / ');
    return { company: companyFromSlash, personLine: formatSignatoryLine(name, title) };
  }
  if (slashParts.length === 2) {
    const second = slashParts[1]!;
    if (/^(mr|ms|mrs|miss|dr)\.?\s/i.test(second)) {
      return { company: slashParts[0]!, personLine: second };
    }
  }

  const personCandidate = legal && trade && trade !== legal ? trade : '';
  if (personCandidate && (/^(mr|ms|mrs|miss|dr)\.?\s/i.test(personCandidate) || /\//.test(personCandidate))) {
    return { company, personLine: personCandidate };
  }
  return { company, personLine: null };
}

/** Prefer single-file TTF/OTF — PDFKit does not render CJK .ttc reliably (mojibake).
 *  Always prefer a CJK-capable face first: site payment/remarks text may be Korean
 *  even when the PDF locale is English (labels in EN + body from site master). */
function resolveFont(locale: Locale): string | null {
  const appFonts = path.resolve(process.cwd(), 'fonts');
  const cjk = [
    path.join(appFonts, 'NotoSansKR-Regular.otf'),
    path.join(appFonts, 'NotoSansJP-Regular.otf'),
    path.join(appFonts, 'NotoSansSC-Regular.otf'),
    '/opt/invoice-service/fonts/NotoSansKR-Regular.otf',
    '/opt/invoice-service/fonts/NotoSansJP-Regular.otf',
    '/opt/invoice-service/fonts/NotoSansSC-Regular.otf',
    '/usr/share/fonts/truetype/noto/NotoSansKR-Regular.ttf',
    '/usr/share/fonts/opentype/noto/NotoSansKR-Regular.otf',
    '/usr/share/fonts/truetype/noto/NotoSansJP-Regular.ttf',
    '/usr/share/fonts/opentype/noto/NotoSansJP-Regular.otf',
    '/usr/share/fonts/truetype/noto/NotoSansSC-Regular.ttf',
    '/usr/share/fonts/opentype/noto/NotoSansSC-Regular.otf',
  ];
  const byLocale: Record<Locale, string[]> = {
    en: [
      ...cjk,
      '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
      '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
    ],
    ko: [
      path.join(appFonts, 'NotoSansKR-Regular.otf'),
      '/opt/invoice-service/fonts/NotoSansKR-Regular.otf',
      '/usr/share/fonts/truetype/noto/NotoSansKR-Regular.ttf',
      '/usr/share/fonts/opentype/noto/NotoSansKR-Regular.otf',
      ...cjk,
      '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    ],
    ja: [
      path.join(appFonts, 'NotoSansJP-Regular.otf'),
      '/opt/invoice-service/fonts/NotoSansJP-Regular.otf',
      '/usr/share/fonts/truetype/noto/NotoSansJP-Regular.ttf',
      '/usr/share/fonts/opentype/noto/NotoSansJP-Regular.otf',
      ...cjk,
      '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    ],
    zh: [
      path.join(appFonts, 'NotoSansSC-Regular.otf'),
      '/opt/invoice-service/fonts/NotoSansSC-Regular.otf',
      '/usr/share/fonts/truetype/noto/NotoSansSC-Regular.ttf',
      '/usr/share/fonts/opentype/noto/NotoSansSC-Regular.otf',
      ...cjk,
      '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    ],
    th: [
      '/usr/share/fonts/truetype/noto/NotoSansThai-Regular.ttf',
      '/usr/share/fonts/truetype/tlwg/Garuda.ttf',
      ...cjk,
      '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    ],
  };
  for (const f of byLocale[locale] || byLocale.en) {
    if (fs.existsSync(f) && !f.toLowerCase().endsWith('.ttc')) return f;
  }
  return null;
}

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function parseBankInfo(raw?: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const j = JSON.parse(raw) as Record<string, unknown>;
    if (j && typeof j === 'object' && !Array.isArray(j)) {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(j)) {
        if (v == null) continue;
        const s = String(v).trim();
        if (s) out[k] = s;
      }
      return out;
    }
  } catch {
    /* plain text */
  }
  const plain = String(raw).trim();
  return plain ? { note: plain } : {};
}

/** Remarks bank lines — skip empty values so blank fields are not printed. */
function bankRemarkLines(
  bank: Record<string, string>,
  locale: Locale,
): Array<{ label: string; value: string; muted?: boolean }> {
  const pairs: Array<[string, string | undefined, boolean?]> = [
    ['pdf.acNo', bank.accountNo || bank.acNo],
    ['pdf.acName', bank.accountName || bank.acName],
    ['pdf.bankName', bank.bankName || bank.bank],
    ['pdf.bankAdd', bank.bankAddress || bank.bankAdd, true],
    ['pdf.branchName', bank.branchName || bank.branch, true],
    ['pdf.swiftCode', bank.swiftCode || bank.swift],
  ];
  const lines: Array<{ label: string; value: string; muted?: boolean }> = [];
  for (const [key, raw, muted] of pairs) {
    const value = String(raw ?? '').trim();
    if (!value) continue;
    lines.push({ label: t(locale, key), value, muted: !!muted });
  }
  // Legacy free-text bank_info fallback
  const note = String(bank.note ?? '').trim();
  if (note && lines.length === 0) {
    lines.push({ label: '', value: note });
  }
  return lines;
}

function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}.${m}.${day}`;
}

/** Payment date = invoice issue date + offset days (site default 3) */
function paymentDueDate(issuedAt: Date, offsetDays = 3): Date {
  const d = new Date(issuedAt.getTime());
  d.setDate(d.getDate() + offsetDays);
  return d;
}

function isZeroDecimalCurrency(currency: string): boolean {
  return ['JPY', 'KRW', 'VND'].includes(currency.toUpperCase());
}

function money(n: string | number, currency?: string): string {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return String(n);
  const zero = currency ? isZeroDecimalCurrency(currency) : false;
  return v.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: zero ? 0 : 2,
  });
}

function qty(n: string | number): string {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return String(n ?? '');
  return v.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  });
}

function cleanRemark(raw?: string | null, ticketNo?: string | null): string {
  const ticket = String(ticketNo || '').trim();
  if (ticket && !ticket.startsWith('SIM-')) return ticket;
  const s = String(raw || '').trim();
  if (!s) return '';
  if (s.startsWith('sim-') || s.startsWith('SIM-')) return '';
  if (s.length > 28) return `${s.slice(0, 26)}…`;
  return s;
}

/** Grayscale circular SAMPLE stamp for simulator PDFs (never real seals). */
function drawSampleSeal(
  doc: PDFKit.PDFDocument,
  cx: number,
  cy: number,
  diameter: number,
  label: string,
): void {
  const r = Math.max(22, diameter / 2);
  doc.save();
  // Absolute coords only — PDFKit rotate+custom-font text often draws off-canvas.
  // Keep current Body font (Noto/CJK has Latin glyphs); do NOT switch to Helvetica
  // or later CJK Terms/Remarks text becomes tofu boxes.
  doc.fillColor('#f3f4f6').circle(cx, cy, r).fill();
  doc.lineWidth(3).strokeColor('#374151');
  doc.circle(cx, cy, r).stroke();
  doc.lineWidth(1.4).strokeColor('#6b7280');
  doc.circle(cx, cy, r - 5).stroke();
  const fontSize = Math.max(10, Math.min(14, r * 0.48));
  doc.fontSize(fontSize).fillColor('#111827');
  const tw = doc.widthOfString(label);
  doc.text(label, cx - tw / 2, cy - fontSize * 0.5, {
    lineBreak: false,
    width: Math.ceil(tw) + 4,
  });
  doc.restore();
}

function unitCell(line: LineItemInput): string {
  if (line.hideUnitPrice) return '—';
  const q = qty(line.quantity);
  if (line.unitLabel !== undefined && line.unitLabel !== null) {
    const label = String(line.unitLabel).trim();
    return label ? `${q} ${label}` : q;
  }
  const u = String(line.unit || '').trim();
  if (u && u !== 'EA' && !/^\d/.test(u)) return `${q} ${u}`;
  return q;
}

function applySiteLinePreset(
  lines: LineItemInput[],
  sitePdf?: SitePdfDefaults | null,
): LineItemInput[] {
  if (!sitePdf || sitePdf.lineSlot === 'off') return lines;
  return lines.map((l) => ({
    ...l,
    item: sitePdf.lineItem || l.item,
    description: sitePdf.lineDescription || l.description,
    unitLabel: sitePdf.lineUnitLabel ?? '',
    hideUnitPrice: sitePdf.lineHideUnitPrice === true,
  }));
}

/**
 * Proforma Invoice PDF — bank remittance style. Labels default to English.
 */
export async function generateInvoicePdf(input: InvoicePdfInput): Promise<{
  pdfPath: string;
  pdfHash: string;
  relativePath: string;
}> {
  const locale = resolvePdfLocale(input.locale ?? DEFAULT_LOCALE);
  ensureDir(config.pdfStorageDir);
  const year = String(input.issuedAt.getUTCFullYear());
  const dir = path.join(config.pdfStorageDir, year, input.sourceSite);
  ensureDir(dir);
  const fileName = `${input.invoiceNo}.pdf`;
  const absPath = path.join(dir, fileName);
  const relativePath = path.relative(config.pdfStorageDir, absPath);
  const fontPath = resolveFont(locale);
  const bank = parseBankInfo(input.seller.bank_info);

  const lines: LineItemInput[] =
    input.lineItems && input.lineItems.length
      ? input.lineItems.map((l) => ({
          ...l,
          remark: cleanRemark(l.remark, input.ticketNo),
        }))
      : [
          {
            item: input.seller.code || 'Item',
            description: input.lineDescription || '',
            unitPrice: input.unitPrice || input.amount,
            quantity: input.quantity || '1',
            amount: input.amount,
            unit: input.unit || 'EA',
            remark: cleanRemark(
              input.asset ? `${input.asset} ${input.assetAmount ?? ''}`.trim() : input.ticketNo,
              input.ticketNo,
            ),
          },
        ];

  const total = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const sitePdfEarly = input.sitePdf;
  const displayLines = applySiteLinePreset(lines, sitePdfEarly);

  let qrBuf: Buffer | null = null;
  if (input.verifyUrl) {
    try {
      qrBuf = await QRCode.toBuffer(String(input.verifyUrl), {
        type: 'png',
        width: 240,
        margin: 1,
        errorCorrectionLevel: 'M',
      });
    } catch {
      qrBuf = null;
    }
  }

  await new Promise<void>((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const stream = fs.createWriteStream(absPath);
    doc.pipe(stream);
    if (fontPath) {
      try {
        doc.registerFont('Body', fontPath);
        doc.font('Body');
      } catch {
        /* Helvetica fallback */
      }
    }

    const leftX = doc.page.margins.left;
    const pageW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const rightX = leftX + pageW * 0.58;
    const bottomLimit = () => doc.page.height - doc.page.margins.bottom - 24;

    // --- Seller header (issuer) ---
    doc
      .fontSize(13)
      .fillColor(COLORS.seller)
      .text(input.seller.legal_name || input.seller.trade_name || '', { width: pageW });
    doc.fontSize(8).fillColor(COLORS.muted);
    if (input.seller.address) doc.text(input.seller.address, { width: pageW });
    const telLine = [
      input.seller.phone ? `${t(locale, 'pdf.tel')}: ${input.seller.phone}` : null,
      bank.fax ? `${t(locale, 'pdf.fax')}: ${bank.fax}` : null,
    ]
      .filter(Boolean)
      .join(', ');
    if (telLine) doc.text(telLine, { width: pageW });
    const website = input.seller.website || bank.website;
    if (website) doc.fillColor(COLORS.buyer).text(website, { width: pageW });
    doc.moveDown(0.55);

    // accent bar
    const barY = doc.y;
    doc.rect(leftX, barY, pageW, 2).fill(COLORS.seller);
    doc.y = barY + 10;

    // --- Title ---
    doc
      .fontSize(16)
      .fillColor(COLORS.seller)
      .text(t(locale, 'pdf.title'), { align: 'center', width: pageW });
    doc.moveDown(0.55);

    // --- Messrs / PI meta (P/I No + Date right-aligned) ---
    const metaY = doc.y;
    const leftMetaW = pageW * 0.55;
    const rightMetaW = pageW * 0.42;
    doc.fontSize(8).fillColor(COLORS.ink).text(t(locale, 'pdf.messrs'), leftX, metaY, {
      width: leftMetaW,
      lineBreak: false,
    });
    doc.fillColor(COLORS.seller).text(`${t(locale, 'pdf.piNo')} ${input.invoiceNo}`, rightX, metaY, {
      width: rightMetaW,
      align: 'right',
      lineBreak: false,
    });
    let buyerY = metaY + 13;
    const messrs = resolveMessrsLines(input.buyer);
    doc.fontSize(10).fillColor(COLORS.ink).text(messrs.company, leftX, buyerY, {
      width: leftMetaW,
      lineBreak: false,
    });
    buyerY = doc.y + 2;
    if (messrs.personLine) {
      doc.fontSize(10).fillColor(COLORS.ink).text(messrs.personLine, leftX, buyerY, {
        width: leftMetaW,
        lineBreak: false,
      });
      buyerY = doc.y;
    }
    doc
      .fontSize(9)
      .fillColor(COLORS.ink)
      .text(`${t(locale, 'pdf.date')} ${fmtDate(input.issuedAt)}`, rightX, metaY + 13, {
        width: rightMetaW,
        align: 'right',
        lineBreak: false,
      });
    doc.fontSize(8).fillColor(COLORS.muted);
    if (input.buyer.address) {
      doc.text(input.buyer.address, leftX, buyerY, { width: leftMetaW });
      buyerY = doc.y;
    }
    if (input.buyer.phone) {
      doc.text(`${t(locale, 'pdf.tel')}: ${input.buyer.phone}`, leftX, buyerY, {
        width: leftMetaW,
      });
      buyerY = doc.y;
    }
    doc.y = Math.max(buyerY, metaY + 28) + 8;
    doc.x = leftX;
    doc.fontSize(9).fillColor(COLORS.ink).text(t(locale, 'pdf.intro'), { width: pageW });
    doc.moveDown(0.3);
    doc.fontSize(8).fillColor(COLORS.muted);
    doc.text(
      `${t(locale, 'pdf.termsOfPayment')} ${
        input.termsOfPayment ||
        sitePdfEarly?.termsOfPayment ||
        t(locale, 'pdf.defaultPaymentTerms')
      }`,
      { width: pageW },
    );
    // Match table → Payment spacing (12pt)
    doc.y += 12;
    doc.x = leftX;

    // --- Table ---
    const cols = {
      item: 78,
      desc: 138,
      price: 72,
      unit: 88,
      amount: 72,
      remark: pageW - (78 + 138 + 72 + 88 + 72),
    };
    const minRowH = 18;

    const measure = (text: string, w: number) =>
      Math.max(minRowH, doc.heightOfString(String(text || ' '), { width: Math.max(8, w - 6) }) + 8);

    const drawVLines = (y: number, h: number, stroke: string) => {
      let gx = leftX;
      const widths = [cols.item, cols.desc, cols.price, cols.unit, cols.amount, cols.remark];
      for (let i = 0; i < widths.length - 1; i++) {
        gx += widths[i];
        doc
          .moveTo(gx, y)
          .lineTo(gx, y + h)
          .stroke(stroke);
      }
    };

    const drawCells = (
      y: number,
      h: number,
      cells: Array<{ text: string; w: number; align: 'left' | 'right' | 'center'; color?: string }>,
      opts?: { header?: boolean },
    ) => {
      let x = leftX + 3;
      for (const cell of cells) {
        const beforeY = doc.y;
        doc
          .fillColor(cell.color || (opts?.header ? COLORS.headerFg : COLORS.ink))
          .text(cell.text, x, y + 4, {
            width: cell.w - 6,
            align: cell.align,
            height: h - 6,
            ellipsis: true,
            lineBreak: true,
          });
        doc.y = beforeY;
        x += cell.w;
      }
      doc.y = y + h;
      doc.x = leftX;
    };

    let y = doc.y;
    doc.fontSize(7.5);
    const headerCells: Array<{
      text: string;
      w: number;
      align: 'left' | 'right' | 'center';
      color?: string;
    }> = [
      { text: t(locale, 'pdf.col.item'), w: cols.item, align: 'center' },
      { text: t(locale, 'pdf.col.description'), w: cols.desc, align: 'center' },
      {
        text: t(locale, 'pdf.col.unitPrice', { currency: input.currency }),
        w: cols.price,
        align: 'center',
      },
      { text: t(locale, 'pdf.col.unit'), w: cols.unit, align: 'center' },
      {
        text: t(locale, 'pdf.col.amount', { currency: input.currency }),
        w: cols.amount,
        align: 'center',
      },
      { text: t(locale, 'pdf.col.remark'), w: cols.remark, align: 'center' },
    ];
    const headerH = Math.max(...headerCells.map((c) => measure(c.text, c.w)), minRowH);
    doc.rect(leftX, y, pageW, headerH).fill(COLORS.headerBg);
    drawVLines(y, headerH, '#1e3a5f');
    drawCells(y, headerH, headerCells, { header: true });
    y += headerH;

    doc.fontSize(8);
    let rowIdx = 0;
    for (const line of displayLines) {
      const hidePrice = line.hideUnitPrice === true;
      const cellData: Array<{
        text: string;
        w: number;
        align: 'left' | 'right' | 'center';
        color?: string;
      }> = [
        { text: String(line.item || ''), w: cols.item, align: 'center' },
        { text: String(line.description || ''), w: cols.desc, align: 'center' },
        {
          text: hidePrice ? '—' : money(line.unitPrice, input.currency),
          w: cols.price,
          align: 'right',
          color: hidePrice ? COLORS.muted : COLORS.amount,
        },
        { text: unitCell(line), w: cols.unit, align: 'center' },
        {
          text: money(line.amount, input.currency),
          w: cols.amount,
          align: 'right',
          color: COLORS.amount,
        },
        { text: String(line.remark || ''), w: cols.remark, align: 'center' },
      ];
      const rowH = Math.max(...cellData.map((c) => measure(c.text, c.w)), minRowH);
      if (y + rowH > bottomLimit()) {
        doc.addPage();
        y = doc.page.margins.top;
      }
      if (rowIdx % 2 === 1) {
        doc.rect(leftX, y, pageW, rowH).fill(COLORS.rowAlt);
      }
      doc.rect(leftX, y, pageW, rowH).stroke(COLORS.border);
      drawVLines(y, rowH, COLORS.line);
      drawCells(y, rowH, cellData);
      y += rowH;
      rowIdx += 1;
    }

    // TOTAL
    if (y + minRowH > bottomLimit()) {
      doc.addPage();
      y = doc.page.margins.top;
    }
    doc.rect(leftX, y, pageW, minRowH).fillAndStroke('#fef2f2', COLORS.amount);
    const amountX = leftX + cols.item + cols.desc + cols.price + cols.unit;
    doc.fontSize(9).fillColor(COLORS.amount);
    const ty = doc.y;
    doc.text(t(locale, 'pdf.total'), leftX + 3, y + 4, {
      width: cols.item + cols.desc + cols.price + cols.unit - 6,
      lineBreak: false,
    });
    doc.y = ty;
    doc.text(money(total || input.amount, input.currency), amountX + 3, y + 4, {
      width: cols.amount - 6,
      align: 'right',
      lineBreak: false,
    });
    doc.y = y + minRowH + 12;
    doc.x = leftX;

    // Payment
    const sitePdf = input.sitePdf;
    const payOffset = sitePdf?.paymentDateOffset ?? 3;
    doc.fontSize(10).fillColor(COLORS.seller).text(t(locale, 'pdf.payment'), {
      underline: true,
      width: pageW,
    });
    doc.moveDown(0.35);
    doc.fontSize(9).fillColor(COLORS.ink);
    const payDate =
      input.paymentDueText || fmtDate(paymentDueDate(input.issuedAt, payOffset));
    doc.text(`${t(locale, 'pdf.paymentDate')}  ${payDate}`, { width: pageW });
    doc.moveDown(0.12);
    const termsBody = sitePdf?.paymentTerms || t(locale, 'pdf.paymentTermsBody');
    doc.text(`${t(locale, 'pdf.paymentTerms')}  ${termsBody}`, {
      width: pageW,
    });
    doc.moveDown(0.12);
    doc.text(sitePdf?.paymentDue || t(locale, 'pdf.paymentDue'), { width: pageW });

    // Remarks (optional)
    if (sitePdf?.remarksEnabled !== false) {
      doc.moveDown(0.65);
      doc.fontSize(10).fillColor(COLORS.seller).text(t(locale, 'pdf.remarks'), {
        underline: true,
        width: pageW,
      });
      doc.moveDown(0.35);
      doc.fontSize(9).fillColor(COLORS.ink);
      if (sitePdf?.remarksNotice) {
        doc.text(sitePdf.remarksNotice, { width: pageW });
        doc.moveDown(0.12);
      }
      const remarkBank = bankRemarkLines(bank, locale);
      for (const row of remarkBank) {
        doc.fillColor(row.muted ? COLORS.muted : COLORS.ink);
        const text = row.label ? `${row.label} ${row.value}` : row.value;
        doc.text(text, { width: pageW });
        doc.moveDown(0.12);
      }
      doc.fillColor(COLORS.ink);
    } else {
      doc.moveDown(0.45);
    }

    // Ticket / Tx meta — same font size & line gap as Remarks bank lines
    const memo = input.memo || '';
    const simTag = memo.match(/^\[SIMULATOR(?::([^\]]*))?\]/i);
    const isSimulator = !!simTag;
    const simFlags = String(simTag?.[1] || '').toLowerCase();
    const watermarkOptOut = /\bnowm\b/.test(simFlags);
    const sampleSealOptOut = /\bnosample\b/.test(simFlags);
    const useSampleSeal =
      isSimulator &&
      !sampleSealOptOut &&
      sitePdfEarly?.simulatorSampleSealEnabled !== false;
    const kindKey = isSimulator
      ? null // simulator: no "Type: Simulator" line — red watermark on signature instead
      : memo.startsWith('[SANDBOX]')
        ? 'pdf.kind.sandbox'
        : null;
    const publicTx =
      input.sourceTransactionId &&
      !input.sourceTransactionId.startsWith('sim-') &&
      !input.sourceTransactionId.startsWith('SIM-')
        ? input.sourceTransactionId
        : '';
    const ticket =
      input.ticketNo && !String(input.ticketNo).startsWith('SIM-') ? String(input.ticketNo) : '';
    const note = memo
      .replace(/^\[(SIMULATOR|SANDBOX)(?::[^\]]*)?\]\s*/i, '')
      .replace(/\|\s*/g, ' ')
      .replace(/\b(network|feeMode)\s*:\s*\S+/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    const metaParts = [
      kindKey ? `${t(locale, 'pdf.kind')}: ${t(locale, kindKey)}` : '',
      ticket ? `${t(locale, 'pdf.ticketNo')}: ${ticket}` : '',
      publicTx ? `${t(locale, 'pdf.transactionId')}: ${publicTx}` : '',
      note && note.length < 80 ? note : '',
    ].filter(Boolean);
    if (metaParts.length) {
      doc.fontSize(9).fillColor(COLORS.ink).text(`- ${metaParts.join(' / ')}`, {
        width: pageW,
      });
      doc.moveDown(0.12);
    }

    // Notice (optional: slot a/b/c) — PDF heading is always "Notice"; slot name is admin-only
    if (sitePdf?.noticeEnabled) {
      doc.moveDown(0.33);
      doc.fontSize(10).fillColor(COLORS.seller).text(t(locale, 'pdf.notice'), {
        underline: true,
        width: pageW,
      });
      doc.moveDown(0.35);
      doc.fontSize(9).fillColor(COLORS.ink);
      if (sitePdf.noticeText) {
        doc.text(sitePdf.noticeText, { width: pageW });
        doc.moveDown(0.12);
      }
      const noticeLines: Array<[string, string | null | undefined]> = [
        ['pdf.noticeBankName', sitePdf.noticeBankName],
        ['pdf.noticeAddress', sitePdf.noticeAddress],
        ['pdf.noticeBankCode', sitePdf.noticeBankCode],
        ['pdf.noticeBranchCode', sitePdf.noticeBranchCode],
        ['pdf.noticeAccountType', sitePdf.noticeAccountType],
        ['pdf.noticeAccountNumber', sitePdf.noticeAccountNumber],
        ['pdf.noticeAccountHolder', sitePdf.noticeAccountHolder],
      ];
      for (const [labelKey, value] of noticeLines) {
        const v = String(value ?? '').trim();
        if (!v) continue;
        doc.fillColor(COLORS.ink);
        doc.text(`${t(locale, labelKey)} ${v}`, { width: pageW });
        doc.moveDown(0.12);
      }
    }

    doc.moveDown(0.88);
    // Mutually exclusive modes: official+stamp | official | signature+stamp | stamp
    // Draw order: Name text first, then PNG on top of the letters (transparent PNG shows text through).
    // official_stamp: 회사직인 on Name, then 도장 on top of the 직인 (CEO area).
    // Wide-type 회사직인 (image): start from 88px square → −10% overall, then −30% height, +20% width.
    const officialBase = 88 * 0.9;
    const officialW = Math.round(officialBase * 1.2); // ≈95
    const officialH = Math.round(officialBase * 0.7); // ≈55
    const stampSize = 32;
    const sigW = 130;
    const sigH = 44;
    const nameFontSize = 8;
    const seal = input.seal;
    const mode = seal?.displayMode ?? 'official_stamp';
    const sealBlockH =
      mode === 'official_stamp' || mode === 'official'
        ? officialH
        : mode === 'signature_stamp' || mode === 'signature'
          ? Math.max(sigH, stampSize)
          : stampSize;
    // Company + person line; seals center on person line
    const namePadAbove = Math.ceil(sealBlockH * 0.45) + 14;
    const namePadBelow = Math.ceil(sealBlockH * 0.55);
    const sigBlockH = namePadAbove + namePadBelow + 20;
    if (doc.y + sigBlockH + 28 > bottomLimit()) {
      doc.addPage();
    }

    const sigTop = doc.y;
    const companyName = seal?.companyName || input.seller.legal_name || input.seller.trade_name || '';
    // Party signatory wins; site seal fields are fallback only
    const sigName =
      String(input.seller.signatory_name || '').trim() || seal?.signatoryName || '';
    const sigTitle =
      String(input.seller.signatory_title || '').trim() || seal?.signatoryTitle || 'CEO';
    const personLine = formatSignatoryLine(sigName, sigTitle);

    // Company name (black) then Name / Title (black) — seals overlay the person line
    doc.fontSize(10).fillColor(COLORS.ink).text(companyName || '—', leftX, sigTop, {
      width: pageW,
      lineBreak: false,
    });

    const nameY = sigTop + namePadAbove;
    doc.fontSize(nameFontSize).fillColor(COLORS.ink).text(personLine, leftX, nameY, {
      width: pageW,
      lineBreak: false,
    });

    // Anchor seals on last token of the person line (e.g. TAKEDA or DIRECTOR area → name side)
    doc.fontSize(nameFontSize);
    const nameOnly = (() => {
      const raw = String(sigName || '').trim() || '—';
      return /^(mr|ms|mrs|miss|dr)\.?\s/i.test(raw) ? raw.replace(/^(mr|ms|mrs|miss|dr)\.?\s+/i, '') : raw;
    })();
    const lastToken = nameOnly.split(/\s+/).filter(Boolean).pop() || nameOnly;
    const personW = doc.widthOfString(personLine);
    const lastTokenW = doc.widthOfString(lastToken);
    // Prefer centering on the name portion (before " / ")
    const slashIdx = personLine.lastIndexOf(' / ');
    const namePart = slashIdx >= 0 ? personLine.slice(0, slashIdx) : personLine;
    const namePartW = doc.widthOfString(namePart);
    const lastTokenX = leftX + Math.max(0, namePartW - lastTokenW);
    const nameMidY = nameY + nameFontSize * 0.35;
    void personW;

    const tryImage = (filePath: string | null | undefined, x: number, yImg: number, w: number, h: number) => {
      if (!filePath || useSampleSeal) return false;
      try {
        doc.image(filePath, x, yImg, { width: w, height: h });
        return true;
      } catch {
        return false;
      }
    };

    let drewAny = false;
    let blockBottom = nameY + namePadBelow;

    if (useSampleSeal) {
      // Simulator SAMPLE mode: grayscale SAMPLE stamp instead of real seals
      const sampleSize = 64;
      const sampleCx = Math.max(leftX + sampleSize / 2, lastTokenX + lastTokenW * 0.5);
      const sampleCy = nameMidY;
      drawSampleSeal(doc, sampleCx, sampleCy, sampleSize, t(locale, 'pdf.sampleSeal'));
      drewAny = true;
      blockBottom = Math.max(blockBottom, sampleCy + sampleSize / 2 + 4);
    } else if (mode === 'official_stamp' || mode === 'official') {
      // 회사직인(와이드형 이미지): Name 글자 중앙에 올려 노출
      const officialX = Math.max(leftX, lastTokenX + lastTokenW * 0.5 - officialW * 0.5);
      const officialY = nameMidY - officialH * 0.5;
      if (seal?.officialPath) {
        drewAny = tryImage(seal.officialPath, officialX, officialY, officialW, officialH) || drewAny;
      }
      if (mode === 'official_stamp' && seal?.stampPath) {
        // 도장: 회사직인(CEO) 위 — 직인 중앙~우하단에 깊게 겹침 (직인 그린 뒤 = 위에 표시)
        const stampX = officialX + officialW * 0.42;
        const stampY = officialY + officialH * 0.4;
        drewAny = tryImage(seal.stampPath, stampX, stampY, stampSize, stampSize) || drewAny;
        blockBottom = Math.max(blockBottom, officialY + officialH, stampY + stampSize);
      } else {
        blockBottom = Math.max(blockBottom, officialY + officialH);
      }
      if (!drewAny) {
        doc.rect(officialX, officialY, officialW, officialH).stroke(COLORS.line);
        blockBottom = officialY + officialH;
      }
    } else if (mode === 'signature_stamp' || mode === 'signature') {
      // 서명: Name 글자 위에 노출
      const sigX = Math.max(leftX, lastTokenX + lastTokenW * 0.5 - sigW * 0.55);
      const sigY = nameMidY - sigH * 0.55;
      if (seal?.signaturePath) {
        drewAny = tryImage(seal.signaturePath, sigX, sigY, sigW, sigH) || drewAny;
      }
      if (mode === 'signature_stamp' && seal?.stampPath) {
        // 도장: 서명(CEO) 위에 겹침
        const stampX = sigX + sigW - stampSize * 0.85;
        const stampY = sigY + sigH * 0.25;
        drewAny = tryImage(seal.stampPath, stampX, stampY, stampSize, stampSize) || drewAny;
        blockBottom = Math.max(blockBottom, stampY + stampSize, sigY + sigH);
      } else {
        blockBottom = Math.max(blockBottom, sigY + sigH);
      }
      if (!drewAny) {
        doc.rect(sigX, sigY, sigW, sigH).stroke(COLORS.line);
        blockBottom = sigY + sigH;
      }
    } else {
      // 도장만 — Name 글자 위에
      const stampX = lastTokenX + lastTokenW * 0.5 - stampSize * 0.5;
      const stampY = nameMidY - stampSize * 0.5;
      if (seal?.stampPath) {
        drewAny = tryImage(seal.stampPath, stampX, stampY, stampSize, stampSize) || drewAny;
      }
      if (!drewAny) {
        doc.rect(stampX, stampY, stampSize, stampSize).stroke(COLORS.line);
      }
      blockBottom = stampY + stampSize;
    }

    // Simulator: red watermark overlapping signature block (no "Type: Simulator" meta line)
    const showSimulatorWm =
      isSimulator &&
      !watermarkOptOut &&
      sitePdf?.simulatorWatermarkEnabled !== false;
    if (showSimulatorWm) {
      const wm =
        String(sitePdf?.simulatorWatermarkText || '').trim() ||
        t(locale, 'pdf.simulatorWatermark');
      doc.fontSize(10).fillColor('#dc2626');
      doc.text(wm, leftX, Math.max(nameY + 6, nameMidY + 4), {
        width: Math.min(pageW, 420),
        align: 'left',
        lineBreak: true,
      });
      blockBottom = Math.max(blockBottom, doc.y);
    }

    doc.y = blockBottom + 12;
    doc.x = leftX;
    doc
      .moveTo(leftX, doc.y)
      .lineTo(leftX + pageW, doc.y)
      .stroke(COLORS.line);
    doc.y += 6;

    // Same footer band: Notice + Invoice Service (left), QR (right)
    const qrSize = 48;
    const footerTop = doc.y;
    const textW = qrBuf ? pageW - qrSize - 10 : pageW;

    doc.fontSize(7).fillColor(COLORS.notice).text(t(locale, 'pdf.eSignNotice'), leftX, footerTop, {
      width: textW,
      align: 'left',
    });
    doc.moveDown(0.25);
    doc.fontSize(7).fillColor(COLORS.notice).text(t(locale, 'pdf.footer'), leftX, doc.y, {
      align: 'left',
      width: textW,
    });
    const textBottom = doc.y;

    if (qrBuf) {
      const drawX = leftX + pageW - qrSize;
      // Align QR to the same footer band (top of notice line)
      const drawY = footerTop;
      doc.image(qrBuf, drawX, drawY, { width: qrSize, height: qrSize });
      doc.y = Math.max(textBottom, drawY + qrSize);
    } else {
      doc.y = textBottom;
    }

    doc.end();
    stream.on('finish', () => resolve());
    stream.on('error', reject);
  });

  const buf = fs.readFileSync(absPath);
  const pdfHash = crypto.createHash('sha256').update(buf).digest('hex');
  return { pdfPath: absPath, pdfHash, relativePath };
}
