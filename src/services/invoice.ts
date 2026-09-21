import type { PoolClient } from 'pg';
import { query, withTransaction } from '../db/pool.js';
import { nextInvoiceNo } from './numbering.js';
import { generateInvoicePdf } from './pdf.js';
import { writeAudit } from './crypto.js';

export type CompletedWebhookBody = {
  site: string;
  event: string;
  occurredAt?: string;
  transactionId: string;
  ticketNo?: string;
  amount: string;
  currency: string;
  asset?: string;
  assetAmount?: string;
  buyerRef?: string;
  sellerEntityCode?: string;
  buyerEntityCode?: string;
  productCode?: string;
  memo?: string;
};

type PartyRow = {
  id: string;
  code: string;
  legal_name: string;
  trade_name: string | null;
  country: string | null;
  address: string | null;
  tax_id: string | null;
  email: string | null;
  phone: string | null;
  bank_info: string | null;
};

type ProductRow = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  unit: string;
  default_currency: string;
};

function partySnap(p: PartyRow) {
  return {
    code: p.code,
    legal_name: p.legal_name,
    trade_name: p.trade_name,
    country: p.country,
    address: p.address,
    tax_id: p.tax_id,
    email: p.email,
    phone: p.phone,
    bank_info: p.bank_info,
  };
}

async function resolveParties(
  client: PoolClient,
  siteId: string,
  body: CompletedWebhookBody,
) {
  const mapping = await client.query<{
    seller_party_id: string;
    buyer_party_id: string;
    product_id: string;
  }>(
    `SELECT seller_party_id, buyer_party_id, product_id
     FROM site_mappings WHERE site_id = $1 AND active = TRUE`,
    [siteId],
  );
  if (mapping.rowCount === 0) {
    throw Object.assign(new Error('api.error.mappingMissing'), {
      status: 422,
      errorKey: 'api.error.mappingMissing',
    });
  }

  let sellerId = mapping.rows[0].seller_party_id;
  let buyerId = mapping.rows[0].buyer_party_id;
  let productId = mapping.rows[0].product_id;

  if (body.sellerEntityCode) {
    const r = await client.query<{ id: string }>(
      `SELECT id FROM parties WHERE code = $1 AND active = TRUE`,
      [body.sellerEntityCode],
    );
    if (!r.rowCount) {
      throw Object.assign(new Error('api.error.sellerNotFound'), {
        status: 422,
        errorKey: 'api.error.sellerNotFound',
      });
    }
    sellerId = r.rows[0].id;
  }
  if (body.buyerEntityCode) {
    const r = await client.query<{ id: string }>(
      `SELECT id FROM parties WHERE code = $1 AND active = TRUE`,
      [body.buyerEntityCode],
    );
    if (!r.rowCount) {
      throw Object.assign(new Error('api.error.buyerNotFound'), {
        status: 422,
        errorKey: 'api.error.buyerNotFound',
      });
    }
    buyerId = r.rows[0].id;
  }
  if (body.productCode) {
    const r = await client.query<{ id: string }>(
      `SELECT id FROM products WHERE code = $1 AND active = TRUE`,
      [body.productCode],
    );
    if (!r.rowCount) {
      throw Object.assign(new Error('api.error.productNotFound'), {
        status: 422,
        errorKey: 'api.error.productNotFound',
      });
    }
    productId = r.rows[0].id;
  }

  const seller = (
    await client.query<PartyRow>(`SELECT * FROM parties WHERE id = $1`, [sellerId])
  ).rows[0];
  const buyer = (
    await client.query<PartyRow>(`SELECT * FROM parties WHERE id = $1`, [buyerId])
  ).rows[0];
  const product = (
    await client.query<ProductRow>(`SELECT * FROM products WHERE id = $1`, [productId])
  ).rows[0];

  return { seller, buyer, product };
}

export async function issueFromWebhook(opts: {
  siteId: string;
  siteCode: string;
  idempotencyKey: string;
  body: CompletedWebhookBody;
  actorType: 'system' | 'site';
  ip?: string;
  locale?: import('../i18n/index.js').Locale;
}) {
  const { siteId, siteCode, idempotencyKey, body, ip, locale } = opts;

  const existing = await query(
    `SELECT * FROM invoices WHERE site_id = $1 AND idempotency_key = $2`,
    [siteId, idempotencyKey],
  );
  if (existing.rowCount) {
    return { invoice: existing.rows[0], idempotentReplay: true };
  }

  return withTransaction(async (client) => {
    // double-check inside tx
    const again = await client.query(
      `SELECT * FROM invoices WHERE site_id = $1 AND idempotency_key = $2 FOR UPDATE`,
      [siteId, idempotencyKey],
    );
    if (again.rowCount) {
      return { invoice: again.rows[0], idempotentReplay: true };
    }

    const { seller, buyer, product } = await resolveParties(client, siteId, body);
    const issuedAt = body.occurredAt ? new Date(body.occurredAt) : new Date();
    if (Number.isNaN(issuedAt.getTime())) {
      throw Object.assign(new Error('api.error.invalidOccurredAt'), {
        status: 400,
        errorKey: 'api.error.invalidOccurredAt',
      });
    }
    const year = issuedAt.getFullYear();
    const invoiceNo = await nextInvoiceNo(client, siteId, siteCode, year);

    const sellerSnapshot = partySnap(seller);
    const buyerSnapshot = partySnap(buyer);
    const productSnapshot = {
      code: product.code,
      name: product.name,
      description: product.description,
      unit: product.unit,
    };

    const amount = body.amount;
    const currency = body.currency || product.default_currency;

    const pdf = await generateInvoicePdf({
      invoiceNo,
      issuedAt,
      currency,
      amount,
      asset: body.asset,
      assetAmount: body.assetAmount,
      ticketNo: body.ticketNo,
      sourceTransactionId: body.transactionId,
      sourceSite: siteCode,
      memo: body.memo,
      seller: sellerSnapshot,
      buyer: buyerSnapshot,
      lineItems: [
        {
          item: product.name,
          description: product.description || product.name,
          unitPrice: amount,
          quantity: body.assetAmount || '1',
          amount,
          unit: body.asset || product.unit,
          remark: body.ticketNo || body.transactionId,
        },
      ],
      locale,
    });

    const inv = await client.query(
      `INSERT INTO invoices (
         invoice_no, status, site_id, source_transaction_id, ticket_no, idempotency_key,
         issued_at, currency, amount, asset, asset_amount, buyer_ref, memo,
         seller_snapshot, buyer_snapshot, product_snapshot,
         pdf_path, pdf_hash, created_by, raw_payload
       ) VALUES (
         $1,'issued',$2,$3,$4,$5,
         $6,$7,$8,$9,$10,$11,$12,
         $13::jsonb,$14::jsonb,$15::jsonb,
         $16,$17,'system',$18::jsonb
       ) RETURNING *`,
      [
        invoiceNo,
        siteId,
        body.transactionId,
        body.ticketNo ?? null,
        idempotencyKey,
        issuedAt.toISOString(),
        currency,
        amount,
        body.asset ?? null,
        body.assetAmount ?? null,
        body.buyerRef ?? null,
        body.memo ?? null,
        JSON.stringify(sellerSnapshot),
        JSON.stringify(buyerSnapshot),
        JSON.stringify(productSnapshot),
        pdf.relativePath,
        pdf.pdfHash,
        JSON.stringify(body),
      ],
    );

    const invoice = inv.rows[0];
    await client.query(
      `INSERT INTO invoice_items (
         invoice_id, line_no, product_code, description, quantity, unit, unit_price, amount, currency, meta_json
       ) VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
      [
        invoice.id,
        product.code,
        product.description || product.name,
        body.assetAmount || '1',
        body.asset || product.unit,
        amount,
        amount,
        currency,
        JSON.stringify({ asset: body.asset, assetAmount: body.assetAmount }),
      ],
    );

    return {
      invoice,
      idempotentReplay: false,
      _audit: {
        eventType: 'invoice.issued' as const,
        siteId,
        invoiceId: invoice.id as string,
        detail: { invoiceNo, idempotencyKey, transactionId: body.transactionId },
      },
    };
  }).then(async (result) => {
    if (!result.idempotentReplay && '_audit' in result && result._audit) {
      await writeAudit({
        eventType: result._audit.eventType,
        actorType: opts.actorType,
        actorId: siteCode,
        siteId: result._audit.siteId,
        invoiceId: result._audit.invoiceId,
        detail: result._audit.detail,
        ip,
      });
    }
    const { _audit, ...rest } = result as typeof result & { _audit?: unknown };
    void _audit;
    return rest;
  });
}

export async function reissueInvoice(invoiceId: string, adminId: string, ip?: string) {
  return withTransaction(async (client) => {
    const cur = await client.query(`SELECT * FROM invoices WHERE id = $1 FOR UPDATE`, [invoiceId]);
    if (!cur.rowCount) {
      throw Object.assign(new Error('api.error.notFound'), {
        status: 404,
        errorKey: 'api.error.notFound',
      });
    }
    const original = cur.rows[0];
    if (original.status === 'void') {
      throw Object.assign(new Error('api.error.cannotReissueVoid'), {
        status: 400,
        errorKey: 'api.error.cannotReissueVoid',
      });
    }

    const site = await client.query<{ code: string }>(
      `SELECT code FROM sites WHERE id = $1`,
      [original.site_id],
    );
    const siteCode = site.rows[0].code;
    const issuedAt = new Date();
    const year = issuedAt.getFullYear();
    const invoiceNo = await nextInvoiceNo(client, original.site_id, siteCode, year);

    const seller = original.seller_snapshot;
    const buyer = original.buyer_snapshot;
    const product = original.product_snapshot;

    const pdf = await generateInvoicePdf({
      invoiceNo,
      issuedAt,
      currency: original.currency,
      amount: String(original.amount),
      asset: original.asset,
      assetAmount: original.asset_amount != null ? String(original.asset_amount) : null,
      ticketNo: original.ticket_no,
      sourceTransactionId: original.source_transaction_id,
      sourceSite: siteCode,
      memo: original.memo,
      seller,
      buyer,
      lineItems: [
        {
          item: product.name || product.code,
          description: product.description || product.name,
          unitPrice: String(original.amount),
          quantity: original.asset_amount != null ? String(original.asset_amount) : '1',
          amount: String(original.amount),
          unit: original.asset || product.unit || 'EA',
          remark: original.ticket_no || original.source_transaction_id,
        },
      ],
    });

    await client.query(`UPDATE invoices SET status = 'reissued', updated_at = NOW() WHERE id = $1`, [
      original.id,
    ]);

    const inv = await client.query(
      `INSERT INTO invoices (
         invoice_no, status, site_id, source_transaction_id, ticket_no, idempotency_key,
         issued_at, currency, amount, asset, asset_amount, buyer_ref, memo,
         seller_snapshot, buyer_snapshot, product_snapshot,
         pdf_path, pdf_hash, created_by, reissued_from_id, raw_payload
       ) VALUES (
         $1,'issued',$2,$3,$4,$5,
         $6,$7,$8,$9,$10,$11,$12,
         $13::jsonb,$14::jsonb,$15::jsonb,
         $16,$17,'admin',$18,$19::jsonb
       ) RETURNING *`,
      [
        invoiceNo,
        original.site_id,
        original.source_transaction_id,
        original.ticket_no,
        `${original.idempotency_key}::reissue::${Date.now()}`,
        issuedAt.toISOString(),
        original.currency,
        original.amount,
        original.asset,
        original.asset_amount,
        original.buyer_ref,
        original.memo,
        JSON.stringify(seller),
        JSON.stringify(buyer),
        JSON.stringify(product),
        pdf.relativePath,
        pdf.pdfHash,
        original.id,
        JSON.stringify({ reissuedFrom: original.invoice_no }),
      ],
    );

    const invoice = inv.rows[0];
    await client.query(
      `INSERT INTO invoice_items (
         invoice_id, line_no, product_code, description, quantity, unit, unit_price, amount, currency
       )
       SELECT $1, line_no, product_code, description, quantity, unit, unit_price, amount, currency
       FROM invoice_items WHERE invoice_id = $2`,
      [invoice.id, original.id],
    );

    return { invoice, original, invoiceNo, siteId: original.site_id as string };
  }).then(async ({ invoice, original, invoiceNo, siteId }) => {
    await writeAudit({
      eventType: 'invoice.reissued',
      actorType: 'admin',
      actorId: adminId,
      siteId,
      invoiceId: invoice.id,
      detail: { from: original.invoice_no, to: invoiceNo },
      ip,
    });
    return invoice;
  });
}
