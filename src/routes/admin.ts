import { Router } from 'express';
import { query } from '../db/pool.js';
import { requireAdmin, requireHq } from '../middleware/auth.js';
import { createApiKey, revokeApiKey } from '../services/apiKeys.js';

export const adminRouter = Router();
adminRouter.use(requireAdmin);

// ---------- Sites ----------
adminRouter.get('/sites', async (_req, res, next) => {
  try {
    const rows = await query(`SELECT * FROM sites ORDER BY code`);
    res.json({ items: rows.rows });
  } catch (e) {
    next(e);
  }
});

adminRouter.post('/sites', requireHq, async (req, res, next) => {
  try {
    const { code, name, notes, active = true } = req.body;
    const row = await query(
      `INSERT INTO sites (code, name, notes, active)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [String(code).toLowerCase(), name, notes ?? null, !!active],
    );
    res.status(201).json({ site: row.rows[0] });
  } catch (e) {
    next(e);
  }
});

adminRouter.patch('/sites/:id', requireHq, async (req, res, next) => {
  try {
    const { name, notes, active } = req.body;
    const row = await query(
      `UPDATE sites SET
         name = COALESCE($2, name),
         notes = COALESCE($3, notes),
         active = COALESCE($4, active),
         updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [req.params.id, name ?? null, notes ?? null, typeof active === 'boolean' ? active : null],
    );
    if (!row.rowCount) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.json({ site: row.rows[0] });
  } catch (e) {
    next(e);
  }
});

// ---------- API Keys ----------
adminRouter.get('/sites/:siteId/keys', async (req, res, next) => {
  try {
    const rows = await query(
      `SELECT id, site_id, label, key_prefix, active, last_used_at, created_at, revoked_at
       FROM api_keys WHERE site_id = $1 ORDER BY created_at DESC`,
      [req.params.siteId],
    );
    res.json({ items: rows.rows });
  } catch (e) {
    next(e);
  }
});

adminRouter.post('/sites/:siteId/keys', requireHq, async (req, res, next) => {
  try {
    const created = await createApiKey(req.params.siteId, req.body.label || 'default');
    res.status(201).json({
      key: created.record,
      apiKey: created.apiKey,
      hmacSecret: created.hmacSecret,
      warning: 'Store apiKey and hmacSecret now — they are shown only once.',
    });
  } catch (e) {
    next(e);
  }
});

adminRouter.post('/keys/:id/revoke', requireHq, async (req, res, next) => {
  try {
    await revokeApiKey(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// ---------- Parties ----------
adminRouter.get('/parties', async (_req, res, next) => {
  try {
    const rows = await query(`SELECT * FROM parties ORDER BY code`);
    res.json({ items: rows.rows });
  } catch (e) {
    next(e);
  }
});

adminRouter.post('/parties', requireHq, async (req, res, next) => {
  try {
    const b = req.body;
    const row = await query(
      `INSERT INTO parties (code, kind, legal_name, trade_name, country, address, tax_id, email, phone, bank_info, extra_json, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12) RETURNING *`,
      [
        b.code,
        b.kind,
        b.legal_name,
        b.trade_name ?? null,
        b.country ?? null,
        b.address ?? null,
        b.tax_id ?? null,
        b.email ?? null,
        b.phone ?? null,
        b.bank_info ?? null,
        JSON.stringify(b.extra_json ?? {}),
        b.active !== false,
      ],
    );
    res.status(201).json({ party: row.rows[0] });
  } catch (e) {
    next(e);
  }
});

adminRouter.patch('/parties/:id', requireHq, async (req, res, next) => {
  try {
    const b = req.body;
    const row = await query(
      `UPDATE parties SET
         kind = COALESCE($2, kind),
         legal_name = COALESCE($3, legal_name),
         trade_name = COALESCE($4, trade_name),
         country = COALESCE($5, country),
         address = COALESCE($6, address),
         tax_id = COALESCE($7, tax_id),
         email = COALESCE($8, email),
         phone = COALESCE($9, phone),
         bank_info = COALESCE($10, bank_info),
         active = COALESCE($11, active),
         updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [
        req.params.id,
        b.kind ?? null,
        b.legal_name ?? null,
        b.trade_name ?? null,
        b.country ?? null,
        b.address ?? null,
        b.tax_id ?? null,
        b.email ?? null,
        b.phone ?? null,
        b.bank_info ?? null,
        typeof b.active === 'boolean' ? b.active : null,
      ],
    );
    if (!row.rowCount) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.json({ party: row.rows[0] });
  } catch (e) {
    next(e);
  }
});

// ---------- Products ----------
adminRouter.get('/products', async (_req, res, next) => {
  try {
    const rows = await query(`SELECT * FROM products ORDER BY code`);
    res.json({ items: rows.rows });
  } catch (e) {
    next(e);
  }
});

adminRouter.post('/products', requireHq, async (req, res, next) => {
  try {
    const b = req.body;
    const row = await query(
      `INSERT INTO products (code, name, description, unit, default_currency, active)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [b.code, b.name, b.description ?? null, b.unit || 'EA', b.default_currency || 'USD', b.active !== false],
    );
    res.status(201).json({ product: row.rows[0] });
  } catch (e) {
    next(e);
  }
});

adminRouter.patch('/products/:id', requireHq, async (req, res, next) => {
  try {
    const b = req.body;
    const row = await query(
      `UPDATE products SET
         name = COALESCE($2, name),
         description = COALESCE($3, description),
         unit = COALESCE($4, unit),
         default_currency = COALESCE($5, default_currency),
         active = COALESCE($6, active),
         updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [
        req.params.id,
        b.name ?? null,
        b.description ?? null,
        b.unit ?? null,
        b.default_currency ?? null,
        typeof b.active === 'boolean' ? b.active : null,
      ],
    );
    if (!row.rowCount) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.json({ product: row.rows[0] });
  } catch (e) {
    next(e);
  }
});

// ---------- Site mappings ----------
adminRouter.get('/mappings', async (_req, res, next) => {
  try {
    const rows = await query(
      `SELECT m.*, s.code AS site_code,
              sp.code AS seller_code, bp.code AS buyer_code, p.code AS product_code
       FROM site_mappings m
       JOIN sites s ON s.id = m.site_id
       JOIN parties sp ON sp.id = m.seller_party_id
       JOIN parties bp ON bp.id = m.buyer_party_id
       JOIN products p ON p.id = m.product_id
       ORDER BY s.code`,
    );
    res.json({ items: rows.rows });
  } catch (e) {
    next(e);
  }
});

adminRouter.put('/mappings/:siteId', requireHq, async (req, res, next) => {
  try {
    const { seller_party_id, buyer_party_id, product_id, active = true } = req.body;
    const row = await query(
      `INSERT INTO site_mappings (site_id, seller_party_id, buyer_party_id, product_id, active)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (site_id) DO UPDATE SET
         seller_party_id = EXCLUDED.seller_party_id,
         buyer_party_id = EXCLUDED.buyer_party_id,
         product_id = EXCLUDED.product_id,
         active = EXCLUDED.active,
         updated_at = NOW()
       RETURNING *`,
      [req.params.siteId, seller_party_id, buyer_party_id, product_id, !!active],
    );
    res.json({ mapping: row.rows[0] });
  } catch (e) {
    next(e);
  }
});

// ---------- Invoices (admin) ----------
adminRouter.get('/invoices', async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Number(req.query.offset) || 0;
    const site = req.query.site ? String(req.query.site) : null;
    const sandboxRaw = String(req.query.sandbox || 'all').toLowerCase();
    const sandbox =
      sandboxRaw === 'yes' || sandboxRaw === 'true' || sandboxRaw === '1'
        ? 'yes'
        : sandboxRaw === 'no' || sandboxRaw === 'false' || sandboxRaw === '0'
          ? 'no'
          : 'all';
    const rows = await query(
      `SELECT i.*, s.code AS site_code,
              (i.memo IS NOT NULL AND i.memo LIKE '[SANDBOX]%') AS is_sandbox
       FROM invoices i
       JOIN sites s ON s.id = i.site_id
       WHERE ($1::text IS NULL OR s.code = $1)
         AND (
           $2::text = 'all'
           OR ($2::text = 'yes' AND i.memo IS NOT NULL AND i.memo LIKE '[SANDBOX]%')
           OR ($2::text = 'no' AND (i.memo IS NULL OR i.memo NOT LIKE '[SANDBOX]%'))
         )
       ORDER BY i.issued_at DESC
       LIMIT $3 OFFSET $4`,
      [site, sandbox, limit, offset],
    );
    res.json({
      items: rows.rows.map((r) => ({
        ...r,
        is_sandbox: Boolean(r.is_sandbox),
      })),
      sandbox,
    });
  } catch (e) {
    next(e);
  }
});

adminRouter.get('/invoices/:id', async (req, res, next) => {
  try {
    const row = await query(
      `SELECT i.*, s.code AS site_code FROM invoices i
       JOIN sites s ON s.id = i.site_id WHERE i.id = $1`,
      [req.params.id],
    );
    if (!row.rowCount) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    const items = await query(`SELECT * FROM invoice_items WHERE invoice_id = $1 ORDER BY line_no`, [
      req.params.id,
    ]);
    res.json({ invoice: row.rows[0], items: items.rows });
  } catch (e) {
    next(e);
  }
});

// ---------- Audit export ----------
adminRouter.get('/audit/export', async (req, res, next) => {
  try {
    const from = String(req.query.from || '1970-01-01');
    const to = String(req.query.to || '2999-12-31');
    const format = String(req.query.format || 'json');
    const rows = await query(
      `SELECT * FROM audit_logs
       WHERE created_at >= $1::timestamptz AND created_at < ($2::timestamptz + interval '1 day')
       ORDER BY created_at ASC`,
      [from, to],
    );
    if (format === 'csv') {
      const header = ['id', 'event_type', 'actor_type', 'actor_id', 'site_id', 'invoice_id', 'ip', 'created_at', 'detail_json'];
      const lines = [header.join(',')];
      for (const r of rows.rows) {
        lines.push(
          [
            r.id,
            r.event_type,
            r.actor_type,
            r.actor_id ?? '',
            r.site_id ?? '',
            r.invoice_id ?? '',
            r.ip ?? '',
            r.created_at.toISOString?.() ?? r.created_at,
            JSON.stringify(r.detail_json).replace(/"/g, '""'),
          ]
            .map((c) => `"${c}"`)
            .join(','),
        );
      }
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="audit-export.csv"');
      res.send(lines.join('\n'));
      return;
    }
    res.json({ items: rows.rows });
  } catch (e) {
    next(e);
  }
});
