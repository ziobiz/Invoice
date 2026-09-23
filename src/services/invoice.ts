import type { PoolClient } from 'pg';
import { query, withTransaction } from '../db/pool.js';
import { config } from '../config.js';
import { nextInvoiceNo } from './numbering.js';
import { generateInvoicePdf } from './pdf.js';
import { writeAudit, randomToken } from './crypto.js';
import { sealConfigFromSite, pdfDefaultsFromSite, type SiteSealRow } from './seal.js';

function verifyUrlFor(token: string): string {
  const base = (config.publicBaseUrl || '').replace(/\/$/, '') || 'http://localhost:3100';
  return `${base}/verify/${encodeURIComponent(token)}`;
}

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
  website?: string | null;
  bank_info: string | null;
  signatory_name?: string | null;
  signatory_title?: string | null;
};

type ProductRow = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  unit: string;
  default_currency: string;
  remark?: string | null;
};

function lineRemark(
  productRemark?: string | null,
  ticketNo?: string | null,
): string {
  const fromProduct = String(productRemark || '').trim();
  if (fromProduct) return fromProduct;
  const ticket = String(ticketNo || '').trim();
  if (ticket && !ticket.startsWith('SIM-')) return ticket;
  return '';
}

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
    website: p.website ?? null,
    bank_info: p.bank_info,
    signatory_name: p.signatory_name ?? null,
    signatory_title: p.signatory_title ?? null,
  };
}

async function resolveParties(
  client: PoolClient,
  siteId: string,
  body: Partial<CompletedWebhookBody> = {},
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

  const partyByCode = async (code: string) => {
    // Prefer same-site party; otherwise any active shared party with that code
    return client.query<{ id: string }>(
      `SELECT id FROM parties
       WHERE code = $1 AND active = TRUE
         AND (site_id = $2 OR site_id IS NULL OR is_shared = TRUE)
       ORDER BY CASE WHEN site_id = $2 THEN 0 WHEN is_shared THEN 1 ELSE 2 END
       LIMIT 1`,
      [code, siteId],
    );
  };

  if (body.sellerEntityCode) {
    const r = await partyByCode(body.sellerEntityCode);
    if (!r.rowCount) {
      throw Object.assign(new Error('api.error.sellerNotFound'), {
        status: 422,
        errorKey: 'api.error.sellerNotFound',
      });
    }
    sellerId = r.rows[0].id;
  }
  if (body.buyerEntityCode) {
    const r = await partyByCode(body.buyerEntityCode);
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

  if (String(sellerId) === String(buyerId)) {
    throw Object.assign(new Error('mappings.sameParty'), {
      status: 422,
      errorKey: 'mappings.sameParty',
    });
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
      remark: product.remark ?? null,
    };

    const amount = body.amount;
    const currency = body.currency || product.default_currency;

    const siteSeal = await client.query<SiteSealRow>(
      `SELECT * FROM sites WHERE id = $1`,
      [siteId],
    );
    const seal = sealConfigFromSite(siteSeal.rows[0], sellerSnapshot.legal_name);
    const sitePdf = pdfDefaultsFromSite(siteSeal.rows[0]);
    const verifyToken = randomToken(24);

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
          remark: lineRemark(product.remark, body.ticketNo),
        },
      ],
      locale,
      seal,
      sitePdf,
      verifyUrl: verifyUrlFor(verifyToken),
    });

    const inv = await client.query(
      `INSERT INTO invoices (
         invoice_no, status, site_id, source_transaction_id, ticket_no, idempotency_key,
         issued_at, currency, amount, asset, asset_amount, buyer_ref, memo,
         seller_snapshot, buyer_snapshot, product_snapshot,
         pdf_path, pdf_hash, created_by, raw_payload, verify_token
       ) VALUES (
         $1,'issued',$2,$3,$4,$5,
         $6,$7,$8,$9,$10,$11,$12,
         $13::jsonb,$14::jsonb,$15::jsonb,
         $16,$17,'api',$18::jsonb,$19
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
        verifyToken,
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
        detail: {
          invoiceNo,
          idempotencyKey,
          transactionId: body.transactionId,
          amount,
          currency,
          ticketNo: body.ticketNo ?? null,
          buyer:
            (buyerSnapshot as { legal_name?: string; code?: string })?.legal_name ||
            (buyerSnapshot as { code?: string })?.code ||
            null,
          seller:
            (sellerSnapshot as { legal_name?: string; code?: string })?.legal_name ||
            (sellerSnapshot as { code?: string })?.code ||
            null,
          product:
            (productSnapshot as { name?: string; code?: string })?.name ||
            (productSnapshot as { code?: string })?.code ||
            null,
        },
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

    const site = await client.query<SiteSealRow>(
      `SELECT * FROM sites WHERE id = $1`,
      [original.site_id],
    );
    if (!site.rowCount) {
      throw Object.assign(new Error('api.error.notFound'), {
        status: 404,
        errorKey: 'api.error.notFound',
      });
    }
    const siteCode = site.rows[0].code;
    const issuedAt = new Date();
    const year = issuedAt.getFullYear();
    const invoiceNo = await nextInvoiceNo(client, original.site_id, siteCode, year);

    // Latest buyer / supplier / product from site mapping (amount stays the same)
    const { seller, buyer, product } = await resolveParties(client, original.site_id, {});
    const sellerSnapshot = partySnap(seller);
    const buyerSnapshot = partySnap(buyer);
    const productSnapshot = {
      code: product.code,
      name: product.name,
      description: product.description,
      unit: product.unit,
      remark: product.remark ?? null,
    };

    const amount = String(original.amount);
    const qty =
      original.asset_amount != null ? String(original.asset_amount) : '1';
    const unit = original.asset || product.unit || 'EA';
    const seal = sealConfigFromSite(site.rows[0], sellerSnapshot.legal_name);
    const sitePdf = pdfDefaultsFromSite(site.rows[0]);
    const verifyToken = randomToken(24);

    const pdf = await generateInvoicePdf({
      invoiceNo,
      issuedAt,
      currency: original.currency,
      amount,
      asset: original.asset,
      assetAmount: original.asset_amount != null ? String(original.asset_amount) : null,
      ticketNo: original.ticket_no,
      sourceTransactionId: original.source_transaction_id,
      sourceSite: siteCode,
      memo: original.memo,
      seller: sellerSnapshot,
      buyer: buyerSnapshot,
      lineItems: [
        {
          item: product.name || product.code,
          description: product.description || product.name,
          unitPrice: amount,
          quantity: qty,
          amount,
          unit,
          remark: lineRemark(product.remark, original.ticket_no),
        },
      ],
      seal,
      sitePdf,
      verifyUrl: verifyUrlFor(verifyToken),
    });

    await client.query(`UPDATE invoices SET status = 'reissued', updated_at = NOW(),
       last_actor_id = COALESCE($2::uuid, last_actor_id)
     WHERE id = $1`, [
      original.id,
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(adminId)
        ? adminId
        : null,
    ]);

    const actorUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(adminId)
        ? adminId
        : null;

    const inv = await client.query(
      `INSERT INTO invoices (
         invoice_no, status, site_id, source_transaction_id, ticket_no, idempotency_key,
         issued_at, currency, amount, asset, asset_amount, buyer_ref, memo,
         seller_snapshot, buyer_snapshot, product_snapshot,
         pdf_path, pdf_hash, created_by, reissued_from_id, raw_payload, verify_token,
         last_actor_id
       ) VALUES (
         $1,'issued',$2,$3,$4,$5,
         $6,$7,$8,$9,$10,$11,$12,
         $13::jsonb,$14::jsonb,$15::jsonb,
         $16,$17,'admin',$18,$19::jsonb,$20,
         $21
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
        JSON.stringify(sellerSnapshot),
        JSON.stringify(buyerSnapshot),
        JSON.stringify(productSnapshot),
        pdf.relativePath,
        pdf.pdfHash,
        original.id,
        JSON.stringify({
          reissuedFrom: original.invoice_no,
          refreshedMaster: true,
          sellerCode: seller.code,
          buyerCode: buyer.code,
          productCode: product.code,
        }),
        verifyToken,
        actorUuid,
      ],
    );

    const invoice = inv.rows[0];
    await client.query(
      `INSERT INTO invoice_items (
         invoice_id, line_no, product_code, description, quantity, unit, unit_price, amount, currency
       ) VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        invoice.id,
        product.code,
        product.description || product.name,
        qty,
        unit,
        original.amount,
        original.amount,
        original.currency,
      ],
    );

    return { invoice, original, invoiceNo, siteId: original.site_id as string };
  }).then(async ({ invoice, original, invoiceNo, siteId }) => {
    await writeAudit({
      eventType: 'invoice.reissued',
      actorType: 'admin',
      actorId: adminId,
      siteId,
      invoiceId: invoice.id,
      detail: {
        from: original.invoice_no,
        to: invoiceNo,
        amount: original.amount,
        currency: original.currency,
        ticketNo: original.ticket_no,
        refreshedMaster: true,
      },
      ip,
    });
    return invoice;
  });
}
