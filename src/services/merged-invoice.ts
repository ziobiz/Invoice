import type { PoolClient } from 'pg';
import path from 'node:path';
import { query, withTransaction } from '../db/pool.js';
import { config } from '../config.js';
import { nextMergedInvoiceNo, mergedRevisionInvoiceNo } from './numbering.js';
import { generateInvoicePdf, type LineItemInput, type PartySnap } from './pdf.js';
import { sealConfigFromSite, pdfDefaultsFromSite, type SiteSealRow } from './seal.js';

export type MergedMode = 'lines' | 'total';

export type MergedLineInput = {
  line_no?: number;
  product_code?: string;
  description: string;
  quantity: string | number;
  unit?: string;
  unit_price: string | number;
  amount: string | number;
  currency?: string;
  source_invoice_id?: string | null;
  item_name?: string | null;
  remark?: string | null;
};

type SourceInvoiceRow = {
  id: string;
  invoice_no: string;
  site_id: string;
  issued_at: Date;
  currency: string;
  amount: string;
  asset: string | null;
  asset_amount: string | null;
  ticket_no: string | null;
  memo: string | null;
  buyer_ref: string | null;
  seller_snapshot: PartySnap;
  buyer_snapshot: PartySnap;
  product_snapshot: {
    code?: string;
    name?: string;
    description?: string;
    unit?: string;
    remark?: string | null;
  };
  status: string;
  deleted_at: Date | null;
};

function partyCode(snap: PartySnap | Record<string, unknown> | null | undefined): string {
  return String((snap as PartySnap)?.code || '').trim().toLowerCase();
}

function kstDateString(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function parseDateOnly(dateStr: string): { start: Date; endExclusive: Date; label: string } {
  const label = String(dateStr || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(label)) {
    throw Object.assign(new Error('merged.invalidDate'), {
      status: 400,
      errorKey: 'merged.invalidDate',
    });
  }
  const start = new Date(`${label}T00:00:00+09:00`);
  const endExclusive = new Date(`${label}T00:00:00+09:00`);
  endExclusive.setDate(endExclusive.getDate() + 1);
  return { start, endExclusive, label };
}

/** Inclusive from/to (YYYY-MM-DD), interpreted as Asia/Seoul calendar days. */
function parseDateRange(fromStr: string, toStr: string): {
  start: Date;
  endExclusive: Date;
  from: string;
  to: string;
} {
  const from = parseDateOnly(fromStr);
  const to = parseDateOnly(toStr);
  if (from.start.getTime() > to.start.getTime()) {
    throw Object.assign(new Error('merged.invalidDateRange'), {
      status: 400,
      errorKey: 'merged.invalidDateRange',
    });
  }
  return {
    start: from.start,
    endExclusive: to.endExclusive,
    from: from.label,
    to: to.label,
  };
}

async function loadSources(client: PoolClient, ids: string[]): Promise<SourceInvoiceRow[]> {
  const r = await client.query<SourceInvoiceRow>(
    `SELECT id, invoice_no, site_id, issued_at, currency, amount::text AS amount,
            asset, asset_amount::text AS asset_amount, ticket_no, memo, buyer_ref,
            seller_snapshot, buyer_snapshot, product_snapshot, status, deleted_at
     FROM invoices
     WHERE id = ANY($1::uuid[])`,
    [ids],
  );
  if (r.rowCount !== ids.length) {
    throw Object.assign(new Error('merged.sourceNotFound'), {
      status: 400,
      errorKey: 'merged.sourceNotFound',
    });
  }
  const map = new Map(r.rows.map((row) => [row.id, row]));
  return ids.map((id) => map.get(id)!);
}

function assertCompatible(sources: SourceInvoiceRow[], siteId: string) {
  if (sources.length < 2) {
    throw Object.assign(new Error('merged.minTwo'), {
      status: 400,
      errorKey: 'merged.minTwo',
    });
  }
  const seller = partyCode(sources[0]!.seller_snapshot);
  const buyer = partyCode(sources[0]!.buyer_snapshot);
  const currency = String(sources[0]!.currency || '').toUpperCase();
  for (const s of sources) {
    if (String(s.site_id) !== String(siteId)) {
      throw Object.assign(new Error('merged.siteMismatch'), {
        status: 400,
        errorKey: 'merged.siteMismatch',
      });
    }
    if (s.status !== 'issued' || s.deleted_at) {
      throw Object.assign(new Error('merged.sourceNotEligible'), {
        status: 400,
        errorKey: 'merged.sourceNotEligible',
      });
    }
    if (String(s.currency || '').toUpperCase() !== currency) {
      throw Object.assign(new Error('merged.currencyMismatch'), {
        status: 400,
        errorKey: 'merged.currencyMismatch',
      });
    }
    if (partyCode(s.seller_snapshot) !== seller || partyCode(s.buyer_snapshot) !== buyer) {
      throw Object.assign(new Error('merged.partyMismatch'), {
        status: 400,
        errorKey: 'merged.partyMismatch',
      });
    }
  }
}

async function assertSourcesFree(client: PoolClient, sourceIds: string[]) {
  const r = await client.query(
    `SELECT DISTINCT mis.source_invoice_id
     FROM merged_invoice_sources mis
     JOIN merged_invoices m ON m.id = mis.merged_id
     WHERE mis.source_invoice_id = ANY($1::uuid[])
       AND m.deleted_at IS NULL
       AND m.revision_no = 1`,
    [sourceIds],
  );
  if (r.rowCount) {
    throw Object.assign(new Error('merged.sourceAlreadyMerged'), {
      status: 400,
      errorKey: 'merged.sourceAlreadyMerged',
    });
  }
}

function buildLines(
  sources: SourceInvoiceRow[],
  mode: MergedMode,
  currency: string,
): MergedLineInput[] {
  if (mode === 'total') {
    const total = sources.reduce((acc, s) => acc + Number(s.amount || 0), 0);
    const names = sources.map((s) => s.invoice_no).join(', ');
    return [
      {
        line_no: 1,
        product_code: 'MERGED',
        description: names,
        quantity: 1,
        unit: 'LOT',
        unit_price: total,
        amount: total,
        currency,
        source_invoice_id: null,
        item_name: 'Consolidated',
        remark: '',
      },
    ];
  }
  return sources.map((s, idx) => {
    const p = s.product_snapshot || {};
    return {
      line_no: idx + 1,
      product_code: p.code || s.invoice_no,
      description: p.description || p.name || s.invoice_no,
      quantity: s.asset_amount || 1,
      unit: s.asset || p.unit || 'EA',
      unit_price: s.amount,
      amount: s.amount,
      currency,
      source_invoice_id: s.id,
      item_name: p.name || s.invoice_no,
      remark: s.ticket_no || '',
    };
  });
}

function linesToPdfItems(lines: MergedLineInput[]): LineItemInput[] {
  return lines.map((l) => ({
    item: l.item_name || l.product_code || '',
    description: l.description,
    unitPrice: l.unit_price,
    quantity: l.quantity,
    amount: l.amount,
    unit: l.unit || 'EA',
    remark: l.remark || '',
  }));
}

async function renderMergedPdf(opts: {
  invoiceNo: string;
  issuedAt: Date;
  currency: string;
  amount: string;
  siteCode: string;
  site: SiteSealRow;
  seller: PartySnap;
  buyer: PartySnap;
  memo?: string | null;
  ticketNo?: string | null;
  asset?: string | null;
  assetAmount?: string | null;
  lines: MergedLineInput[];
  sourceTxLabel: string;
}) {
  const seal = sealConfigFromSite(opts.site, opts.seller.legal_name);
  const sitePdf = pdfDefaultsFromSite(opts.site);
  return generateInvoicePdf({
    invoiceNo: opts.invoiceNo,
    issuedAt: opts.issuedAt,
    currency: opts.currency,
    amount: opts.amount,
    asset: opts.asset,
    assetAmount: opts.assetAmount,
    ticketNo: opts.ticketNo,
    sourceTransactionId: opts.sourceTxLabel,
    sourceSite: opts.siteCode,
    memo: opts.memo,
    seller: opts.seller,
    buyer: opts.buyer,
    lineItems: linesToPdfItems(opts.lines),
    locale: 'en',
    seal,
    sitePdf,
    verifyUrl: null,
  });
}

async function insertItems(
  client: PoolClient,
  mergedId: string,
  lines: MergedLineInput[],
  currency: string,
) {
  for (const l of lines) {
    await client.query(
      `INSERT INTO merged_invoice_items (
         merged_id, line_no, product_code, description, quantity, unit,
         unit_price, amount, currency, source_invoice_id, item_name, remark
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        mergedId,
        l.line_no ?? 1,
        l.product_code || '',
        l.description,
        l.quantity,
        l.unit || 'EA',
        l.unit_price,
        l.amount,
        l.currency || currency,
        l.source_invoice_id || null,
        l.item_name || null,
        l.remark || null,
      ],
    );
  }
}

export async function listMergedCandidates(opts: {
  /** empty / omit = all sites */
  siteId?: string | null;
  from: string;
  to: string;
  /** empty / omit = all sellers */
  sellerCode?: string | null;
  /** empty / omit = all buyers */
  buyerCode?: string | null;
}) {
  const { start, endExclusive, from, to } = parseDateRange(opts.from, opts.to);
  const siteId = String(opts.siteId || '').trim() || null;
  const sellerCode = String(opts.sellerCode || '')
    .trim()
    .toLowerCase() || null;
  const buyerCode = String(opts.buyerCode || '')
    .trim()
    .toLowerCase() || null;
  const rows = await query<SourceInvoiceRow & { site_code: string }>(
    `SELECT i.id, i.invoice_no, i.site_id, i.issued_at, i.currency, i.amount::text AS amount,
            i.asset, i.asset_amount::text AS asset_amount, i.ticket_no, i.memo, i.buyer_ref,
            i.seller_snapshot, i.buyer_snapshot, i.product_snapshot, i.status, i.deleted_at,
            s.code AS site_code
     FROM invoices i
     JOIN sites s ON s.id = i.site_id
     WHERE ($1::uuid IS NULL OR i.site_id = $1)
       AND i.status = 'issued'
       AND i.deleted_at IS NULL
       AND i.issued_at >= $2 AND i.issued_at < $3
       AND ($4::text IS NULL OR lower(trim(coalesce(i.seller_snapshot->>'code', ''))) = $4)
       AND ($5::text IS NULL OR lower(trim(coalesce(i.buyer_snapshot->>'code', ''))) = $5)
       AND NOT EXISTS (
         SELECT 1 FROM merged_invoice_sources mis
         JOIN merged_invoices m ON m.id = mis.merged_id
         WHERE mis.source_invoice_id = i.id
           AND m.deleted_at IS NULL
           AND m.revision_no = 1
       )
     ORDER BY s.code ASC, i.issued_at ASC, i.invoice_no ASC`,
    [siteId, start.toISOString(), endExclusive.toISOString(), sellerCode, buyerCode],
  );

  const items = rows.rows.map((r) => ({
    id: r.id,
    invoice_no: r.invoice_no,
    site_id: r.site_id,
    site_code: r.site_code,
    issued_at: r.issued_at,
    currency: r.currency,
    amount: r.amount,
    seller_code: partyCode(r.seller_snapshot),
    buyer_code: partyCode(r.buyer_snapshot),
    seller_name: (r.seller_snapshot as PartySnap)?.legal_name || '',
    buyer_name: (r.buyer_snapshot as PartySnap)?.legal_name || '',
    product_name: r.product_snapshot?.name || '',
    group_key: `${r.site_id}|${r.currency}|${partyCode(r.seller_snapshot)}|${partyCode(r.buyer_snapshot)}`,
    date: kstDateString(new Date(r.issued_at)),
  }));

  return { from, to, items };
}

export async function createMergedInvoice(opts: {
  siteId: string;
  sourceIds: string[];
  mode: MergedMode;
  actorId?: string | null;
  /** optional search range metadata only */
  from?: string | null;
  to?: string | null;
}) {
  const mode: MergedMode = opts.mode === 'total' ? 'total' : 'lines';
  const sourceIds = [...new Set(opts.sourceIds.map(String))];

  return withTransaction(async (client) => {
    await assertSourcesFree(client, sourceIds);
    const sources = await loadSources(client, sourceIds);
    assertCompatible(sources, opts.siteId);

    const site = await client.query<SiteSealRow & { code: string }>(
      `SELECT * FROM sites WHERE id = $1`,
      [opts.siteId],
    );
    if (!site.rowCount) {
      throw Object.assign(new Error('merged.siteNotFound'), {
        status: 404,
        errorKey: 'merged.siteNotFound',
      });
    }
    const siteRow = site.rows[0]!;
    const currency = String(sources[0]!.currency);
    const seller = sources[0]!.seller_snapshot as PartySnap;
    const buyer = sources[0]!.buyer_snapshot as PartySnap;
    const product = sources[0]!.product_snapshot || {};
    const total = sources.reduce((acc, s) => acc + Number(s.amount || 0), 0);
    // Use latest source issued_at as merged document date
    const issuedAt = sources.reduce((latest, s) => {
      const d = new Date(s.issued_at);
      return d > latest ? d : latest;
    }, new Date(sources[0]!.issued_at));
    const year = issuedAt.getFullYear();
    const invoiceNo = await nextMergedInvoiceNo(client, opts.siteId, siteRow.code, year);
    const lines = buildLines(sources, mode, currency);
    const sourceTxLabel = sources.map((s) => s.invoice_no).join('+');

    const pdf = await renderMergedPdf({
      invoiceNo,
      issuedAt,
      currency,
      amount: String(total),
      siteCode: siteRow.code,
      site: siteRow,
      seller,
      buyer,
      memo: sources.map((s) => s.memo).filter(Boolean).join(' / ') || null,
      ticketNo: null,
      asset: null,
      assetAmount: null,
      lines,
      sourceTxLabel,
    });

    const idRes = await client.query<{ id: string }>(`SELECT gen_random_uuid() AS id`);
    const id = idRes.rows[0]!.id;

    await client.query(
      `INSERT INTO merged_invoices (
         id, invoice_no, site_id, issued_at, currency, amount, mode,
         seller_snapshot, buyer_snapshot, product_snapshot,
         memo, ticket_no, asset, asset_amount, buyer_ref,
         pdf_path, pdf_hash, root_id, revision_no, revised_from_id,
         created_by, last_actor_id
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,
         $8::jsonb,$9::jsonb,$10::jsonb,
         $11,$12,$13,$14,$15,
         $16,$17,$1,1,NULL,
         'admin',$18
       )`,
      [
        id,
        invoiceNo,
        opts.siteId,
        issuedAt.toISOString(),
        currency,
        total,
        mode,
        JSON.stringify(seller),
        JSON.stringify(buyer),
        JSON.stringify(product),
        sources.map((s) => s.memo).filter(Boolean).join(' / ') || null,
        null,
        null,
        null,
        null,
        pdf.relativePath,
        pdf.pdfHash,
        opts.actorId || null,
      ],
    );

    for (const s of sources) {
      await client.query(
        `INSERT INTO merged_invoice_sources (merged_id, source_invoice_id) VALUES ($1,$2)`,
        [id, s.id],
      );
    }
    await insertItems(client, id, lines, currency);

    const row = await client.query(`SELECT * FROM merged_invoices WHERE id = $1`, [id]);
    return { merged: row.rows[0], items: lines };
  });
}

export async function createMergedRevision(opts: {
  fromId: string;
  actorId?: string | null;
  currency?: string;
  amount?: string | number;
  mode?: MergedMode;
  seller_snapshot?: PartySnap;
  buyer_snapshot?: PartySnap;
  product_snapshot?: Record<string, unknown>;
  memo?: string | null;
  ticket_no?: string | null;
  asset?: string | null;
  asset_amount?: string | number | null;
  buyer_ref?: string | null;
  issued_at?: string;
  items: MergedLineInput[];
}) {
  return withTransaction(async (client) => {
    const cur = await client.query(`SELECT * FROM merged_invoices WHERE id = $1`, [opts.fromId]);
    if (!cur.rowCount) {
      throw Object.assign(new Error('merged.notFound'), {
        status: 404,
        errorKey: 'merged.notFound',
      });
    }
    const from = cur.rows[0];
    if (from.deleted_at) {
      throw Object.assign(new Error('merged.cannotEditDeleted'), {
        status: 400,
        errorKey: 'merged.cannotEditDeleted',
      });
    }

    const rootId = String(from.root_id || from.id);
    const root = await client.query(`SELECT * FROM merged_invoices WHERE id = $1`, [rootId]);
    const rootRow = root.rows[0] || from;
    const maxRev = await client.query<{ m: number }>(
      `SELECT COALESCE(MAX(revision_no), 1)::int AS m FROM merged_invoices WHERE root_id = $1`,
      [rootId],
    );
    const revisionNo = Number(maxRev.rows[0]?.m || 1) + 1;
    const invoiceNo = mergedRevisionInvoiceNo(String(rootRow.invoice_no), revisionNo);

    const site = await client.query<SiteSealRow & { code: string }>(
      `SELECT * FROM sites WHERE id = $1`,
      [from.site_id],
    );
    if (!site.rowCount) {
      throw Object.assign(new Error('merged.siteNotFound'), {
        status: 404,
        errorKey: 'merged.siteNotFound',
      });
    }

    const items = (opts.items || []).map((l, i) => ({
      ...l,
      line_no: l.line_no ?? i + 1,
    }));
    if (!items.length) {
      throw Object.assign(new Error('merged.itemsRequired'), {
        status: 400,
        errorKey: 'merged.itemsRequired',
      });
    }

    const currency = String(opts.currency ?? from.currency);
    const amount =
      opts.amount != null
        ? Number(opts.amount)
        : items.reduce((acc, l) => acc + Number(l.amount || 0), 0);
    const mode: MergedMode =
      opts.mode === 'total' || opts.mode === 'lines' ? opts.mode : from.mode;
    const seller = {
      ...(from.seller_snapshot || {}),
      ...(opts.seller_snapshot || {}),
    } as PartySnap;
    const buyer = {
      ...(from.buyer_snapshot || {}),
      ...(opts.buyer_snapshot || {}),
    } as PartySnap;
    const product = {
      ...(from.product_snapshot || {}),
      ...(opts.product_snapshot || {}),
    };
    const issuedAt = opts.issued_at ? new Date(opts.issued_at) : new Date(from.issued_at);

    const sources = await client.query(
      `SELECT source_invoice_id FROM merged_invoice_sources WHERE merged_id = $1`,
      [from.id],
    );
    const sourceNos = await client.query<{ invoice_no: string }>(
      `SELECT invoice_no FROM invoices WHERE id = ANY($1::uuid[])`,
      [sources.rows.map((r) => r.source_invoice_id)],
    );

    const pdf = await renderMergedPdf({
      invoiceNo,
      issuedAt,
      currency,
      amount: String(amount),
      siteCode: site.rows[0]!.code,
      site: site.rows[0]!,
      seller,
      buyer,
      memo: opts.memo !== undefined ? opts.memo : from.memo,
      ticketNo: opts.ticket_no !== undefined ? opts.ticket_no : from.ticket_no,
      asset: opts.asset !== undefined ? opts.asset : from.asset,
      assetAmount:
        opts.asset_amount !== undefined
          ? opts.asset_amount == null
            ? null
            : String(opts.asset_amount)
          : from.asset_amount != null
            ? String(from.asset_amount)
            : null,
      lines: items,
      sourceTxLabel: sourceNos.rows.map((r) => r.invoice_no).join('+') || invoiceNo,
    });

    const idRes = await client.query<{ id: string }>(`SELECT gen_random_uuid() AS id`);
    const id = idRes.rows[0]!.id;

    await client.query(
      `INSERT INTO merged_invoices (
         id, invoice_no, site_id, issued_at, currency, amount, mode,
         seller_snapshot, buyer_snapshot, product_snapshot,
         memo, ticket_no, asset, asset_amount, buyer_ref,
         pdf_path, pdf_hash, root_id, revision_no, revised_from_id,
         created_by, last_actor_id
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,
         $8::jsonb,$9::jsonb,$10::jsonb,
         $11,$12,$13,$14,$15,
         $16,$17,$18,$19,$20,
         'admin',$21
       )`,
      [
        id,
        invoiceNo,
        from.site_id,
        issuedAt.toISOString(),
        currency,
        amount,
        mode,
        JSON.stringify(seller),
        JSON.stringify(buyer),
        JSON.stringify(product),
        opts.memo !== undefined ? opts.memo : from.memo,
        opts.ticket_no !== undefined ? opts.ticket_no : from.ticket_no,
        opts.asset !== undefined ? opts.asset : from.asset,
        opts.asset_amount !== undefined ? opts.asset_amount : from.asset_amount,
        opts.buyer_ref !== undefined ? opts.buyer_ref : from.buyer_ref,
        pdf.relativePath,
        pdf.pdfHash,
        rootId,
        revisionNo,
        from.id,
        opts.actorId || null,
      ],
    );

    for (const s of sources.rows) {
      await client.query(
        `INSERT INTO merged_invoice_sources (merged_id, source_invoice_id) VALUES ($1,$2)`,
        [id, s.source_invoice_id],
      );
    }
    await insertItems(client, id, items, currency);

    const row = await client.query(`SELECT * FROM merged_invoices WHERE id = $1`, [id]);
    return { merged: row.rows[0] };
  });
}

export async function getMergedDetail(id: string) {
  const row = await query(
    `SELECT m.*, s.code AS site_code, s.name AS site_name
     FROM merged_invoices m
     JOIN sites s ON s.id = m.site_id
     WHERE m.id = $1`,
    [id],
  );
  if (!row.rowCount) return null;
  const m = row.rows[0];
  const rootId = m.root_id || m.id;
  const [items, sources, versions] = await Promise.all([
    query(
      `SELECT * FROM merged_invoice_items WHERE merged_id = $1 ORDER BY line_no`,
      [id],
    ),
    query(
      `SELECT i.id, i.invoice_no, i.amount::text AS amount, i.currency, i.issued_at
       FROM merged_invoice_sources mis
       JOIN invoices i ON i.id = mis.source_invoice_id
       WHERE mis.merged_id = $1
       ORDER BY i.invoice_no`,
      [id],
    ),
    query(
      `SELECT id, invoice_no, revision_no, amount::text AS amount, deleted_at, created_at
       FROM merged_invoices
       WHERE root_id = $1
       ORDER BY revision_no ASC`,
      [rootId],
    ),
  ]);
  return {
    merged: m,
    items: items.rows,
    sources: sources.rows,
    versions: versions.rows,
    is_original: Number(m.revision_no) === 1,
  };
}

export async function softDeleteMerged(id: string, actorId?: string | null) {
  const row = await query(
    `UPDATE merged_invoices
     SET deleted_at = COALESCE(deleted_at, NOW()),
         updated_at = NOW(),
         last_actor_id = COALESCE($2, last_actor_id)
     WHERE id = $1
     RETURNING *`,
    [id, actorId || null],
  );
  if (!row.rowCount) {
    throw Object.assign(new Error('merged.notFound'), {
      status: 404,
      errorKey: 'merged.notFound',
    });
  }
  return row.rows[0];
}

export async function listMerged(opts: {
  site?: string | null;
  from?: string | null;
  to?: string | null;
  q?: string | null;
  includeDeleted?: boolean;
}) {
  const params: unknown[] = [];
  const where: string[] = [];
  if (!opts.includeDeleted) {
    where.push('m.deleted_at IS NULL');
  }
  if (opts.site) {
    params.push(opts.site);
    where.push(`(s.code = $${params.length} OR m.site_id::text = $${params.length})`);
  }
  if (opts.from) {
    params.push(opts.from);
    where.push(`m.issued_at >= $${params.length}::date`);
  }
  if (opts.to) {
    params.push(opts.to);
    where.push(`m.issued_at < ($${params.length}::date + interval '1 day')`);
  }
  if (opts.q) {
    params.push(`%${opts.q}%`);
    where.push(
      `(m.invoice_no ILIKE $${params.length} OR COALESCE(m.memo,'') ILIKE $${params.length})`,
    );
  }
  const sql = `
    SELECT m.id, m.invoice_no, m.site_id, s.code AS site_code, m.issued_at,
           m.currency, m.amount::text AS amount, m.mode, m.revision_no, m.root_id,
           m.deleted_at, m.pdf_path, m.created_at,
           CASE WHEN m.revision_no = 1 THEN 'original' ELSE 'revision' END AS kind
    FROM merged_invoices m
    JOIN sites s ON s.id = m.site_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY m.issued_at DESC, m.invoice_no DESC
    LIMIT 500`;
  const rows = await query(sql, params);
  return { items: rows.rows };
}

export function mergedPdfAbsPath(relativePath: string | null | undefined): string | null {
  if (!relativePath) return null;
  return path.join(config.pdfStorageDir, relativePath);
}
