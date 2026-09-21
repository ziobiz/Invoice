import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import PDFDocument from 'pdfkit';
import { config } from '../config.js';
import { t, type Locale, DEFAULT_LOCALE } from '../i18n/index.js';

export type PartySnap = {
  code: string;
  legal_name: string;
  trade_name?: string | null;
  country?: string | null;
  address?: string | null;
  tax_id?: string | null;
  email?: string | null;
  phone?: string | null;
  bank_info?: string | null;
};

export type LineItemInput = {
  item?: string;
  description: string;
  unitPrice: string | number;
  quantity: string | number;
  amount: string | number;
  unit?: string;
  remark?: string;
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
  /** @deprecated single-line helpers — prefer lineItems */
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
};

const FONT_CANDIDATES = [
  '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/truetype/noto/NotoSansThai-Regular.ttf',
  '/usr/share/fonts/truetype/tlwg/Garuda.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
];

function resolveFont(locale: Locale): string | null {
  if (locale === 'th') {
    const thai = [
      '/usr/share/fonts/truetype/noto/NotoSansThai-Regular.ttf',
      '/usr/share/fonts/truetype/tlwg/Garuda.ttf',
      '/usr/share/fonts/truetype/tlwg/Loma.ttf',
    ];
    for (const f of thai) if (fs.existsSync(f)) return f;
  }
  for (const f of FONT_CANDIDATES) {
    if (fs.existsSync(f)) return f;
  }
  return null;
}

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function parseBankInfo(raw?: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const j = JSON.parse(raw) as Record<string, string>;
    if (j && typeof j === 'object') return j;
  } catch {
    /* plain text */
  }
  return { note: raw };
}

function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}.${m}.${day}`;
}

function money(n: string | number): string {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return String(n);
  return v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 8 });
}

/**
 * Proforma Invoice PDF matching templates/proforma-invoice-dealmai.xlsx layout.
 */
export async function generateInvoicePdf(input: InvoicePdfInput): Promise<{
  pdfPath: string;
  pdfHash: string;
  relativePath: string;
}> {
  const locale = input.locale ?? DEFAULT_LOCALE;
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
      ? input.lineItems
      : [
          {
            item: input.seller.code || 'Item',
            description: input.lineDescription || '',
            unitPrice: input.unitPrice || input.amount,
            quantity: input.quantity || '1',
            amount: input.amount,
            unit: input.unit || 'EA',
            remark: input.asset
              ? `${input.asset} ${input.assetAmount ?? ''}`.trim()
              : input.ticketNo || '',
          },
        ];

  const total = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);

  await new Promise<void>((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 36 });
    const stream = fs.createWriteStream(absPath);
    doc.pipe(stream);
    if (fontPath) {
      try {
        doc.font(fontPath);
      } catch {
        /* default */
      }
    }

    const pageW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    let y = doc.page.margins.top;

    // --- Seller header ---
    doc.fontSize(14).text(input.seller.legal_name || input.seller.trade_name || '', {
      width: pageW,
      align: 'left',
    });
    y = doc.y;
    doc.fontSize(8).fillColor('#333');
    if (input.seller.address) doc.text(input.seller.address, { width: pageW });
    const telLine = [
      input.seller.phone ? `${t(locale, 'pdf.tel')}: ${input.seller.phone}` : null,
      bank.fax ? `${t(locale, 'pdf.fax')}: ${bank.fax}` : null,
    ]
      .filter(Boolean)
      .join(', ');
    if (telLine) doc.text(telLine, { width: pageW });
    if (bank.website) doc.text(bank.website, { width: pageW });
    doc.moveDown(0.8);

    // --- Title ---
    doc.fontSize(16).fillColor('#000').text(t(locale, 'pdf.title'), { align: 'center' });
    doc.moveDown(0.8);

    // --- Messrs / PI meta (two columns) ---
    const leftX = doc.page.margins.left;
    const rightX = leftX + pageW * 0.58;
    const metaY = doc.y;
    doc.fontSize(9).text(`${t(locale, 'pdf.messrs')}`, leftX, metaY, { width: pageW * 0.55 });
    doc.text(`${t(locale, 'pdf.piNo')} ${input.invoiceNo}`, rightX, metaY, {
      width: pageW * 0.42,
    });
    doc.text(input.buyer.legal_name || '', leftX, doc.y, { width: pageW * 0.55 });
    const dateY = metaY + 12;
    doc.text(`${t(locale, 'pdf.date')} ${fmtDate(input.issuedAt)}`, rightX, dateY, {
      width: pageW * 0.42,
    });
    if (input.buyer.address) {
      doc.text(input.buyer.address, leftX, doc.y, { width: pageW * 0.55 });
    }
    if (input.buyer.phone) {
      doc.text(`${t(locale, 'pdf.tel')}: ${input.buyer.phone}`, leftX, doc.y, {
        width: pageW * 0.55,
      });
    }
    doc.moveDown(0.6);
    doc.x = leftX;
    doc.fontSize(9).text(t(locale, 'pdf.intro'), { width: pageW });
    doc.moveDown(0.4);
    doc.text(
      `${t(locale, 'pdf.originOfGoods')} ${input.originOfGoods || input.seller.country || ''}`,
    );
    doc.text(`${t(locale, 'pdf.termsOfPrice')} ${input.termsOfPrice || input.currency}`);
    doc.text(
      `${t(locale, 'pdf.termsOfPayment')} ${
        input.termsOfPayment || t(locale, 'pdf.defaultPaymentTerms')
      }`,
    );
    doc.text(`${t(locale, 'pdf.timeOfDelivery')} ${input.timeOfDelivery || ''}`);
    doc.moveDown(0.3);
    doc.fontSize(8).fillColor('#444').text(t(locale, 'pdf.signBack'), { align: 'right' });
    doc.fillColor('#000').moveDown(0.4);

    // --- Table header ---
    const cols = {
      item: 70,
      desc: 180,
      price: 75,
      unit: 45,
      amount: 75,
      remark: 70,
    };
    const rowH = 16;
    y = doc.y;
    doc.rect(leftX, y, pageW, rowH).stroke('#333');
    doc.fontSize(8);
    let x = leftX + 2;
    const headers = [
      [t(locale, 'pdf.col.item'), cols.item],
      [t(locale, 'pdf.col.description'), cols.desc],
      [t(locale, 'pdf.col.unitPrice', { currency: input.currency }), cols.price],
      [t(locale, 'pdf.col.unit'), cols.unit],
      [t(locale, 'pdf.col.amount', { currency: input.currency }), cols.amount],
      [t(locale, 'pdf.col.remark'), cols.remark],
    ] as const;
    for (const [label, w] of headers) {
      doc.text(label, x, y + 4, { width: w - 4, align: 'left' });
      x += w;
    }
    y += rowH;

    for (const line of lines) {
      const descH = Math.max(
        rowH,
        doc.heightOfString(String(line.description || ''), { width: cols.desc - 4 }) + 6,
      );
      if (y + descH > doc.page.height - 120) {
        doc.addPage();
        y = doc.page.margins.top;
      }
      doc.rect(leftX, y, pageW, descH).stroke('#999');
      x = leftX + 2;
      const cells: [string, number, string][] = [
        [String(line.item || ''), cols.item, 'left'],
        [String(line.description || ''), cols.desc, 'left'],
        [money(line.unitPrice), cols.price, 'right'],
        [String(line.quantity ?? ''), cols.unit, 'right'],
        [money(line.amount), cols.amount, 'right'],
        [String(line.remark || ''), cols.remark, 'left'],
      ];
      for (const [text, w, align] of cells) {
        doc.text(text, x, y + 3, { width: w - 4, align: align as 'left' | 'right' });
        x += w;
      }
      y += descH;
    }

    // TOTAL
    doc.rect(leftX, y, pageW, rowH).stroke('#333');
    doc.fontSize(9).text(t(locale, 'pdf.total'), leftX + 2, y + 4, { width: 100 });
    doc.text(money(total || input.amount), leftX + cols.item + cols.desc + cols.price + cols.unit, y + 4, {
      width: cols.amount - 4,
      align: 'right',
    });
    y += rowH + 10;
    doc.y = y;

    // Payment block
    doc.fontSize(10).text(t(locale, 'pdf.payment'), { underline: true });
    doc.fontSize(9);
    doc.text(
      `${t(locale, 'pdf.paymentDate')}  ${
        input.paymentDueText || ''
      }`,
    );
    doc.text(`${t(locale, 'pdf.paymentTerms')}  ${t(locale, 'pdf.paymentTermsBody')}`, {
      width: pageW,
    });
    doc.text(t(locale, 'pdf.paymentDue'));
    doc.moveDown(0.4);
    doc.fontSize(10).text(t(locale, 'pdf.remarks'), { underline: true });
    doc.fontSize(9);
    doc.text(`${t(locale, 'pdf.acNo')} ${bank.accountNo || bank.acNo || ''}`);
    doc.text(`${t(locale, 'pdf.acName')} ${bank.accountName || bank.acName || input.seller.legal_name}`);
    doc.text(`${t(locale, 'pdf.bankAdd')} ${bank.bankAddress || bank.bankAdd || ''}`);
    doc.text(`${t(locale, 'pdf.branchName')} ${bank.branchName || bank.branch || ''}`);
    doc.text(`${t(locale, 'pdf.swiftCode')} ${bank.swiftCode || bank.swift || ''}`);
    doc.moveDown(0.4);
    if (input.sourceTransactionId) {
      doc.fontSize(8).fillColor('#555').text(
        `${t(locale, 'pdf.transactionId')}: ${input.sourceTransactionId}` +
          (input.ticketNo ? `  /  ${t(locale, 'pdf.ticketNo')}: ${input.ticketNo}` : '') +
          (input.memo ? `  /  ${t(locale, 'pdf.memo')}: ${input.memo}` : ''),
        { width: pageW },
      );
      doc.fillColor('#000');
    }
    doc.moveDown(1.2);
    const sigY = doc.y;
    doc.fontSize(9).text(t(locale, 'pdf.acceptedBy'), leftX, sigY);
    doc.text(t(locale, 'pdf.yoursTruly'), rightX, sigY);
    doc.moveDown(2);
    doc.fontSize(7).fillColor('#666').text(t(locale, 'pdf.footer'), { align: 'center', width: pageW });

    doc.end();
    stream.on('finish', () => resolve());
    stream.on('error', reject);
  });

  const buf = fs.readFileSync(absPath);
  const pdfHash = crypto.createHash('sha256').update(buf).digest('hex');
  return { pdfPath: absPath, pdfHash, relativePath };
}
