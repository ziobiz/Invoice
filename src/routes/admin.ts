import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { query, withTransaction } from '../db/pool.js';
import { requireAdmin, requireHq } from '../middleware/auth.js';
import { createApiKey, revokeApiKey } from '../services/apiKeys.js';
import { config } from '../config.js';
import { flagsFromSealMode, isSealAssetKind, resolveSealAbs, resolveSealDisplayMode, saveSealAsset } from '../services/seal.js';
import { writeAudit } from '../services/crypto.js';
import { assertSensitiveOtp } from './auth.js';
import {
  listMergedCandidates,
  createMergedInvoice,
  createMergedRevision,
  getMergedDetail,
  softDeleteMerged,
  listMerged,
  mergedPdfAbsPath,
  type MergedMode,
} from '../services/merged-invoice.js';

export const adminRouter = Router();
adminRouter.use(requireAdmin);

async function logAdmin(
  req: { session?: { adminId?: string }; ip?: string },
  eventType: string,
  opts: {
    siteId?: string | null;
    invoiceId?: string | null;
    detail?: Record<string, unknown>;
  } = {},
) {
  await writeAudit({
    eventType,
    actorType: 'admin',
    actorId: req.session?.adminId ?? null,
    siteId: opts.siteId ?? null,
    invoiceId: opts.invoiceId ?? null,
    detail: opts.detail ?? {},
    ip: req.ip ?? null,
  });
}

const upload = multer({
  dest: path.join(config.sealStorageDir, '_tmp'),
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /^image\/(png|jpeg|jpg|webp)$/i.test(file.mimetype);
    if (ok) cb(null, true);
    else cb(new Error('Only PNG/JPEG/WebP allowed'));
  },
});

fs.mkdirSync(path.join(config.sealStorageDir, '_tmp'), { recursive: true });

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
    const { code, name, notes, active = true, use_shared_parties = false } = req.body;
    const defaultTermsOfPayment = 'T/T';
    const defaultTerms =
      'The above TOTAL amount must be deposited in full (The remittance fee is to be paid by the remitter)';
    const defaultDue = 'Please deposit by the due date';
    const defaultNotice =
      'Notice: This invoice is electronically generated and is valid without a physical signature or company seal.';
    const row = await query(
      `INSERT INTO sites (
         code, name, notes, active, use_shared_parties,
         pdf_payment_date_offset, pdf_terms_of_payment, pdf_payment_terms, pdf_payment_due,
         pdf_notice_slot, pdf_notice_a_name, pdf_notice_a_text,
         pdf_notice_b_name, pdf_notice_b_text,
         pdf_notice_c_name, pdf_notice_c_text,
         pdf_notice_text
       ) VALUES ($1, $2, $3, $4, $5, 3, $6, $7, $8, 'off', 'Active A', $9, 'Active B', $9, 'Active C', $9, $9)
       RETURNING *`,
      [
        String(code).toLowerCase(),
        name,
        notes ?? null,
        !!active,
        !!use_shared_parties,
        defaultTermsOfPayment,
        defaultTerms,
        defaultDue,
        defaultNotice,
      ],
    );
    await logAdmin(req, 'site.created', {
      siteId: row.rows[0].id,
      detail: { code: row.rows[0].code, name: row.rows[0].name },
    });
    res.status(201).json({ site: row.rows[0] });
  } catch (e) {
    next(e);
  }
});

adminRouter.patch('/sites/:id', requireHq, async (req, res, next) => {
  try {
    const b = req.body || {};
    const {
      name,
      notes,
      active,
      signatory_name,
      signatory_title,
      seal_use_official,
      seal_use_stamp,
      seal_use_signature,
      pdf_payment_date_offset,
      pdf_payment_terms,
      pdf_payment_due,
      pdf_remarks_notice,
      pdf_remarks_enabled,
      pdf_notice_slot,
    } = b;

    let oFlag: boolean | null = typeof seal_use_official === 'boolean' ? seal_use_official : null;
    let sFlag: boolean | null = typeof seal_use_stamp === 'boolean' ? seal_use_stamp : null;
    let gFlag: boolean | null = typeof seal_use_signature === 'boolean' ? seal_use_signature : null;
    if (oFlag !== null || sFlag !== null || gFlag !== null) {
      const normalized = flagsFromSealMode(
        resolveSealDisplayMode({
          useOfficial: oFlag ?? false,
          useStamp: sFlag ?? false,
          useSignature: gFlag ?? false,
        }),
      );
      oFlag = normalized.useOfficial;
      sFlag = normalized.useStamp;
      gFlag = normalized.useSignature;
    }

    const offsetRaw =
      pdf_payment_date_offset !== undefined && pdf_payment_date_offset !== null
        ? Number(pdf_payment_date_offset)
        : null;
    const offsetVal =
      offsetRaw != null && Number.isFinite(offsetRaw)
        ? Math.max(0, Math.min(365, Math.floor(offsetRaw)))
        : null;

    const slotRaw = pdf_notice_slot !== undefined ? String(pdf_notice_slot).toLowerCase() : null;
    const slotVal =
      slotRaw === 'off' || slotRaw === 'a' || slotRaw === 'b' || slotRaw === 'c' ? slotRaw : null;
    const noticeEnabledVal = slotVal != null ? slotVal !== 'off' : null;

    const str = (k: string) => (b[k] !== undefined ? String(b[k]) : null);

    const row = await query(
      `UPDATE sites SET
         name = COALESCE($2, name),
         notes = COALESCE($3, notes),
         active = COALESCE($4, active),
         signatory_name = COALESCE($5, signatory_name),
         signatory_title = COALESCE($6, signatory_title),
         seal_use_official = COALESCE($7, seal_use_official),
         seal_use_stamp = COALESCE($8, seal_use_stamp),
         seal_use_signature = COALESCE($9, seal_use_signature),
         pdf_payment_date_offset = COALESCE($10, pdf_payment_date_offset),
         pdf_payment_terms = COALESCE($11, pdf_payment_terms),
         pdf_payment_due = COALESCE($12, pdf_payment_due),
         pdf_remarks_notice = COALESCE($13, pdf_remarks_notice),
         pdf_remarks_enabled = COALESCE($14, pdf_remarks_enabled),
         pdf_notice_slot = COALESCE($15, pdf_notice_slot),
         pdf_notice_enabled = COALESCE($16, pdf_notice_enabled),
         pdf_notice_a_name = COALESCE($17, pdf_notice_a_name),
         pdf_notice_a_text = COALESCE($18, pdf_notice_a_text),
         pdf_notice_a_bank_name = COALESCE($19, pdf_notice_a_bank_name),
         pdf_notice_a_address = COALESCE($20, pdf_notice_a_address),
         pdf_notice_a_bank_code = COALESCE($21, pdf_notice_a_bank_code),
         pdf_notice_a_branch_code = COALESCE($22, pdf_notice_a_branch_code),
         pdf_notice_a_account_type = COALESCE($23, pdf_notice_a_account_type),
         pdf_notice_a_account_number = COALESCE($24, pdf_notice_a_account_number),
         pdf_notice_a_account_holder = COALESCE($25, pdf_notice_a_account_holder),
         pdf_notice_b_name = COALESCE($26, pdf_notice_b_name),
         pdf_notice_b_text = COALESCE($27, pdf_notice_b_text),
         pdf_notice_b_bank_name = COALESCE($28, pdf_notice_b_bank_name),
         pdf_notice_b_address = COALESCE($29, pdf_notice_b_address),
         pdf_notice_b_bank_code = COALESCE($30, pdf_notice_b_bank_code),
         pdf_notice_b_branch_code = COALESCE($31, pdf_notice_b_branch_code),
         pdf_notice_b_account_type = COALESCE($32, pdf_notice_b_account_type),
         pdf_notice_b_account_number = COALESCE($33, pdf_notice_b_account_number),
         pdf_notice_b_account_holder = COALESCE($34, pdf_notice_b_account_holder),
         pdf_notice_c_name = COALESCE($35, pdf_notice_c_name),
         pdf_notice_c_text = COALESCE($36, pdf_notice_c_text),
         pdf_notice_c_bank_name = COALESCE($37, pdf_notice_c_bank_name),
         pdf_notice_c_address = COALESCE($38, pdf_notice_c_address),
         pdf_notice_c_bank_code = COALESCE($39, pdf_notice_c_bank_code),
         pdf_notice_c_branch_code = COALESCE($40, pdf_notice_c_branch_code),
         pdf_notice_c_account_type = COALESCE($41, pdf_notice_c_account_type),
         pdf_notice_c_account_number = COALESCE($42, pdf_notice_c_account_number),
         pdf_notice_c_account_holder = COALESCE($43, pdf_notice_c_account_holder),
         pdf_line_slot = COALESCE($44, pdf_line_slot),
         pdf_line_a_name = COALESCE($45, pdf_line_a_name),
         pdf_line_a_item = COALESCE($46, pdf_line_a_item),
         pdf_line_a_description = COALESCE($47, pdf_line_a_description),
         pdf_line_a_unit_label = COALESCE($48, pdf_line_a_unit_label),
         pdf_line_a_hide_unit_price = COALESCE($49, pdf_line_a_hide_unit_price),
         pdf_line_b_name = COALESCE($50, pdf_line_b_name),
         pdf_line_b_item = COALESCE($51, pdf_line_b_item),
         pdf_line_b_description = COALESCE($52, pdf_line_b_description),
         pdf_line_b_unit_label = COALESCE($53, pdf_line_b_unit_label),
         pdf_line_b_hide_unit_price = COALESCE($54, pdf_line_b_hide_unit_price),
         pdf_line_c_name = COALESCE($55, pdf_line_c_name),
         pdf_line_c_item = COALESCE($56, pdf_line_c_item),
         pdf_line_c_description = COALESCE($57, pdf_line_c_description),
         pdf_line_c_unit_label = COALESCE($58, pdf_line_c_unit_label),
         pdf_line_c_hide_unit_price = COALESCE($59, pdf_line_c_hide_unit_price),
         pdf_simulator_watermark_enabled = COALESCE($60, pdf_simulator_watermark_enabled),
         pdf_simulator_watermark_text = COALESCE($61, pdf_simulator_watermark_text),
         pdf_terms_of_payment = COALESCE($62, pdf_terms_of_payment),
         pdf_simulator_sample_seal_enabled = COALESCE($63, pdf_simulator_sample_seal_enabled),
         invoice_retention_days = CASE
           WHEN $64::boolean THEN $65::int
           ELSE invoice_retention_days
         END,
         use_shared_parties = COALESCE($66, use_shared_parties),
         updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [
        req.params.id,
        name ?? null,
        notes ?? null,
        typeof active === 'boolean' ? active : null,
        signatory_name !== undefined ? String(signatory_name) : null,
        signatory_title !== undefined ? String(signatory_title) : null,
        oFlag,
        sFlag,
        gFlag,
        offsetVal,
        pdf_payment_terms !== undefined ? String(pdf_payment_terms) : null,
        pdf_payment_due !== undefined ? String(pdf_payment_due) : null,
        pdf_remarks_notice !== undefined ? String(pdf_remarks_notice) : null,
        typeof pdf_remarks_enabled === 'boolean' ? pdf_remarks_enabled : null,
        slotVal,
        noticeEnabledVal,
        str('pdf_notice_a_name'),
        str('pdf_notice_a_text'),
        str('pdf_notice_a_bank_name'),
        str('pdf_notice_a_address'),
        str('pdf_notice_a_bank_code'),
        str('pdf_notice_a_branch_code'),
        str('pdf_notice_a_account_type'),
        str('pdf_notice_a_account_number'),
        str('pdf_notice_a_account_holder'),
        str('pdf_notice_b_name'),
        str('pdf_notice_b_text'),
        str('pdf_notice_b_bank_name'),
        str('pdf_notice_b_address'),
        str('pdf_notice_b_bank_code'),
        str('pdf_notice_b_branch_code'),
        str('pdf_notice_b_account_type'),
        str('pdf_notice_b_account_number'),
        str('pdf_notice_b_account_holder'),
        str('pdf_notice_c_name'),
        str('pdf_notice_c_text'),
        str('pdf_notice_c_bank_name'),
        str('pdf_notice_c_address'),
        str('pdf_notice_c_bank_code'),
        str('pdf_notice_c_branch_code'),
        str('pdf_notice_c_account_type'),
        str('pdf_notice_c_account_number'),
        str('pdf_notice_c_account_holder'),
        (() => {
          const raw = b.pdf_line_slot !== undefined ? String(b.pdf_line_slot).toLowerCase() : null;
          return raw === 'off' || raw === 'a' || raw === 'b' || raw === 'c' ? raw : null;
        })(),
        str('pdf_line_a_name'),
        str('pdf_line_a_item'),
        str('pdf_line_a_description'),
        b.pdf_line_a_unit_label !== undefined ? String(b.pdf_line_a_unit_label) : null,
        typeof b.pdf_line_a_hide_unit_price === 'boolean' ? b.pdf_line_a_hide_unit_price : null,
        str('pdf_line_b_name'),
        str('pdf_line_b_item'),
        str('pdf_line_b_description'),
        b.pdf_line_b_unit_label !== undefined ? String(b.pdf_line_b_unit_label) : null,
        typeof b.pdf_line_b_hide_unit_price === 'boolean' ? b.pdf_line_b_hide_unit_price : null,
        str('pdf_line_c_name'),
        str('pdf_line_c_item'),
        str('pdf_line_c_description'),
        b.pdf_line_c_unit_label !== undefined ? String(b.pdf_line_c_unit_label) : null,
        typeof b.pdf_line_c_hide_unit_price === 'boolean' ? b.pdf_line_c_hide_unit_price : null,
        typeof b.pdf_simulator_watermark_enabled === 'boolean'
          ? b.pdf_simulator_watermark_enabled
          : null,
        b.pdf_simulator_watermark_text !== undefined
          ? String(b.pdf_simulator_watermark_text)
          : null,
        b.pdf_terms_of_payment !== undefined ? String(b.pdf_terms_of_payment) : null,
        typeof b.pdf_simulator_sample_seal_enabled === 'boolean'
          ? b.pdf_simulator_sample_seal_enabled
          : null,
        Object.prototype.hasOwnProperty.call(b, 'invoice_retention_days'),
        (() => {
          if (!Object.prototype.hasOwnProperty.call(b, 'invoice_retention_days')) return null;
          const raw = b.invoice_retention_days;
          if (raw === null || raw === '' || raw === false) return null;
          const n = Number(raw);
          if (!Number.isFinite(n) || n <= 0) return null;
          return Math.max(1, Math.min(30, Math.floor(n)));
        })(),
        typeof b.use_shared_parties === 'boolean' ? b.use_shared_parties : null,
      ],
    );
    if (!row.rowCount) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    await logAdmin(req, 'site.updated', {
      siteId: row.rows[0].id,
      detail: {
        code: row.rows[0].code,
        keys: Object.keys(b).filter((k) => b[k] !== undefined),
      },
    });
    res.json({ site: row.rows[0] });
  } catch (e) {
    next(e);
  }
});

adminRouter.delete('/sites/:id', requireHq, async (req, res, next) => {
  try {
    const siteId = String(req.params.id || '').trim();
    const inv = await query<{ c: number }>(
      `SELECT COUNT(*)::int AS c FROM invoices WHERE site_id = $1`,
      [siteId],
    );
    if ((inv.rows[0]?.c ?? 0) > 0) {
      res.status(409).json({ error: 'sites.deleteHasInvoices', errorKey: 'sites.deleteHasInvoices' });
      return;
    }
    const merged = await query<{ c: number }>(
      `SELECT COUNT(*)::int AS c FROM merged_invoices WHERE site_id = $1`,
      [siteId],
    );
    if ((merged.rows[0]?.c ?? 0) > 0) {
      res.status(409).json({ error: 'sites.deleteHasMerged', errorKey: 'sites.deleteHasMerged' });
      return;
    }

    const row = await withTransaction(async (client) => {
      // audit_logs.site_id has NO ACTION — clear before site delete
      await client.query(`UPDATE audit_logs SET site_id = NULL WHERE site_id = $1`, [siteId]);
      const del = await client.query<{ id: string; code: string }>(
        `DELETE FROM sites WHERE id = $1 RETURNING id, code`,
        [siteId],
      );
      return del;
    });

    if (!row.rowCount) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    await logAdmin(req, 'site.deleted', {
      siteId: row.rows[0].id,
      detail: { code: row.rows[0].code },
    });
    res.json({ ok: true, site: row.rows[0] });
  } catch (e) {
    next(e);
  }
});

adminRouter.post(
  '/sites/:id/seals/:kind',
  requireHq,
  upload.single('file'),
  async (req, res, next) => {
    try {
      const kind = String(req.params.kind || '');
      if (!isSealAssetKind(kind)) {
        res.status(400).json({ error: 'Invalid seal kind' });
        return;
      }
      if (!req.file) {
        res.status(400).json({ error: 'file required' });
        return;
      }
      const site = await query(`SELECT id, code FROM sites WHERE id = $1`, [req.params.id]);
      if (!site.rowCount) {
        try {
          fs.unlinkSync(req.file.path);
        } catch {
          /* */
        }
        res.status(404).json({ error: 'Not found' });
        return;
      }
      const rel = saveSealAsset(site.rows[0].code, kind, req.file.path, req.file.originalname);
      try {
        fs.unlinkSync(req.file.path);
      } catch {
        /* tmp cleanup */
      }
      const col =
        kind === 'official'
          ? 'seal_official_path'
          : kind === 'stamp'
            ? 'seal_stamp_path'
            : 'seal_signature_path';
      const row = await query(
        `UPDATE sites SET ${col} = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
        [req.params.id, rel],
      );
      await logAdmin(req, 'site.seal.uploaded', {
        siteId: req.params.id,
        detail: { code: site.rows[0].code, kind, path: rel },
      });
      res.json({ site: row.rows[0], kind, path: rel });
    } catch (e) {
      next(e);
    }
  },
);

adminRouter.get('/sites/:id/seals/:kind', async (req, res, next) => {
  try {
    const kind = String(req.params.kind || '');
    if (!isSealAssetKind(kind)) {
      res.status(400).json({ error: 'Invalid seal kind' });
      return;
    }
    const site = await query(`SELECT * FROM sites WHERE id = $1`, [req.params.id]);
    if (!site.rowCount) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    const s = site.rows[0];
    const rel =
      kind === 'official'
        ? s.seal_official_path
        : kind === 'stamp'
          ? s.seal_stamp_path
          : s.seal_signature_path;
    const abs = resolveSealAbs(rel);
    if (!abs) {
      res.status(404).json({ error: 'Asset not found' });
      return;
    }
    res.sendFile(abs);
  } catch (e) {
    next(e);
  }
});

adminRouter.delete('/sites/:id/seals/:kind', requireHq, async (req, res, next) => {
  try {
    const kind = String(req.params.kind || '');
    if (!isSealAssetKind(kind)) {
      res.status(400).json({ error: 'Invalid seal kind' });
      return;
    }
    const col =
      kind === 'official'
        ? 'seal_official_path'
        : kind === 'stamp'
          ? 'seal_stamp_path'
          : 'seal_signature_path';
    const prev = await query(`SELECT ${col} AS p FROM sites WHERE id = $1`, [req.params.id]);
    if (!prev.rowCount) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    const abs = resolveSealAbs(prev.rows[0].p);
    if (abs) {
      try {
        fs.unlinkSync(abs);
      } catch {
        /* ignore */
      }
    }
    const row = await query(
      `UPDATE sites SET ${col} = NULL, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [req.params.id],
    );
    await logAdmin(req, 'site.seal.deleted', {
      siteId: req.params.id,
      detail: { code: row.rows[0]?.code, kind },
    });
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
    await logAdmin(req, 'site.key.issued', {
      siteId: req.params.siteId,
      detail: {
        keyId: created.record.id,
        label: created.record.label,
        keyPrefix: created.record.key_prefix,
      },
    });
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
    const prev = await query(`SELECT id, site_id, key_prefix, label FROM api_keys WHERE id = $1`, [
      req.params.id,
    ]);
    await revokeApiKey(req.params.id);
    if (prev.rowCount) {
      await logAdmin(req, 'site.key.revoked', {
        siteId: prev.rows[0].site_id,
        detail: {
          keyId: prev.rows[0].id,
          label: prev.rows[0].label,
          keyPrefix: prev.rows[0].key_prefix,
        },
      });
    }
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// ---------- Parties ----------
adminRouter.get('/parties', async (req, res, next) => {
  try {
    const site = req.query.site ? String(req.query.site).trim() : null;
    const kind = req.query.kind ? String(req.query.kind).trim() : null;
    const rows = await query(
      `SELECT p.*, s.code AS site_code, s.name AS site_name
       FROM parties p
       LEFT JOIN sites s ON s.id = p.site_id
       WHERE ($1::text IS NULL OR s.code = $1 OR p.site_id::text = $1)
         AND ($2::text IS NULL OR p.kind = $2 OR ($2 = 'seller' AND p.kind = 'both') OR ($2 = 'buyer' AND p.kind = 'both')
              OR (($2 = 'seller' OR $2 = 'buyer') AND p.is_shared = TRUE))
       ORDER BY s.code NULLS LAST, p.kind, p.code`,
      [site, kind],
    );
    res.json({ items: rows.rows });
  } catch (e) {
    next(e);
  }
});

adminRouter.post('/parties', requireHq, async (req, res, next) => {
  try {
    const b = req.body;
    if (!b.site_id && !b.site) {
      res.status(400).json({ error: 'site_id required' });
      return;
    }
    let siteId = b.site_id ? String(b.site_id) : null;
    if (!siteId && b.site) {
      const s = await query(`SELECT id FROM sites WHERE code = $1`, [String(b.site).toLowerCase()]);
      if (!s.rowCount) {
        res.status(400).json({ error: 'site not found' });
        return;
      }
      siteId = s.rows[0].id;
    }
    const bankInfo =
      b.bank_info != null
        ? typeof b.bank_info === 'string'
          ? b.bank_info
          : JSON.stringify(b.bank_info)
        : null;
    const row = await query(
      `INSERT INTO parties (
         site_id, code, kind, legal_name, trade_name, country, address, tax_id,
         email, phone, website, bank_info, signatory_name, signatory_title, extra_json, active, is_shared
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16,$17) RETURNING *`,
      [
        siteId,
        b.code,
        b.kind,
        b.legal_name,
        b.trade_name ?? null,
        b.country ?? null,
        b.address ?? null,
        b.tax_id ?? null,
        b.email ?? null,
        b.phone ?? null,
        b.website ?? null,
        bankInfo,
        b.signatory_name !== undefined ? String(b.signatory_name || '').trim() : null,
        b.signatory_title !== undefined ? String(b.signatory_title || '').trim() : null,
        JSON.stringify(b.extra_json ?? {}),
        b.active !== false,
        b.is_shared === true,
      ],
    );
    await logAdmin(req, 'party.created', {
      siteId: row.rows[0].site_id,
      detail: { code: row.rows[0].code, kind: row.rows[0].kind, legalName: row.rows[0].legal_name },
    });
    res.status(201).json({ party: row.rows[0] });
  } catch (e) {
    next(e);
  }
});

adminRouter.patch('/parties/:id', requireHq, async (req, res, next) => {
  try {
    const b = req.body;
    const bankInfo =
      b.bank_info === undefined
        ? null
        : typeof b.bank_info === 'string'
          ? b.bank_info
          : JSON.stringify(b.bank_info);
    // Code is immutable on edit — only create/copy may set a new code
    const row = await query(
      `UPDATE parties SET
         site_id = COALESCE($2, site_id),
         kind = COALESCE($3, kind),
         legal_name = COALESCE($4, legal_name),
         trade_name = COALESCE($5, trade_name),
         country = COALESCE($6, country),
         address = COALESCE($7, address),
         tax_id = COALESCE($8, tax_id),
         email = COALESCE($9, email),
         phone = COALESCE($10, phone),
         website = COALESCE($11, website),
         bank_info = COALESCE($12, bank_info),
         signatory_name = COALESCE($13, signatory_name),
         signatory_title = COALESCE($14, signatory_title),
         active = COALESCE($15, active),
         is_shared = COALESCE($16, is_shared),
         updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [
        req.params.id,
        b.site_id ?? null,
        b.kind ?? null,
        b.legal_name ?? null,
        b.trade_name ?? null,
        b.country ?? null,
        b.address ?? null,
        b.tax_id ?? null,
        b.email ?? null,
        b.phone ?? null,
        b.website !== undefined ? b.website : null,
        bankInfo,
        b.signatory_name !== undefined ? String(b.signatory_name || '').trim() : null,
        b.signatory_title !== undefined ? String(b.signatory_title || '').trim() : null,
        typeof b.active === 'boolean' ? b.active : null,
        typeof b.is_shared === 'boolean' ? b.is_shared : null,
      ],
    );
    if (!row.rowCount) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    await logAdmin(req, 'party.updated', {
      siteId: row.rows[0].site_id,
      detail: { code: row.rows[0].code, kind: row.rows[0].kind, legalName: row.rows[0].legal_name },
    });
    res.json({ party: row.rows[0] });
  } catch (e) {
    next(e);
  }
});

adminRouter.delete('/parties/:id', requireHq, async (req, res, next) => {
  try {
    const id = req.params.id;
    const mapped = await query(
      `SELECT id FROM site_mappings
       WHERE seller_party_id = $1 OR buyer_party_id = $1
       LIMIT 1`,
      [id],
    );
    if (mapped.rowCount) {
      res.status(409).json({ error: 'parties.deleteInUse' });
      return;
    }
    const row = await query(`DELETE FROM parties WHERE id = $1 RETURNING *`, [id]);
    if (!row.rowCount) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    await logAdmin(req, 'party.deleted', {
      siteId: row.rows[0].site_id,
      detail: { code: row.rows[0].code, kind: row.rows[0].kind, legalName: row.rows[0].legal_name },
    });
    res.json({ ok: true, party: row.rows[0] });
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
      `INSERT INTO products (code, name, description, unit, default_currency, remark, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [
        b.code,
        b.name,
        b.description ?? null,
        b.unit || 'EA',
        b.default_currency || 'USD',
        b.remark !== undefined ? String(b.remark) : null,
        b.active !== false,
      ],
    );
    await logAdmin(req, 'product.created', {
      detail: { code: row.rows[0].code, name: row.rows[0].name },
    });
    res.status(201).json({ product: row.rows[0] });
  } catch (e) {
    next(e);
  }
});

adminRouter.patch('/products/:id', requireHq, async (req, res, next) => {
  try {
    const b = req.body;
    // Code is immutable on edit (same as parties) — ignore body.code
    const row = await query(
      `UPDATE products SET
         name = COALESCE($2, name),
         description = COALESCE($3, description),
         unit = COALESCE($4, unit),
         default_currency = COALESCE($5, default_currency),
         remark = COALESCE($6, remark),
         active = COALESCE($7, active),
         updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [
        req.params.id,
        b.name ?? null,
        b.description ?? null,
        b.unit ?? null,
        b.default_currency ?? null,
        b.remark !== undefined ? String(b.remark) : null,
        typeof b.active === 'boolean' ? b.active : null,
      ],
    );
    if (!row.rowCount) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    await logAdmin(req, 'product.updated', {
      detail: { code: row.rows[0].code, name: row.rows[0].name, active: row.rows[0].active },
    });
    res.json({ product: row.rows[0] });
  } catch (e) {
    next(e);
  }
});

adminRouter.delete('/products/:id', requireHq, async (req, res, next) => {
  try {
    const id = req.params.id;
    const mapped = await query(
      `SELECT id FROM site_mappings WHERE product_id = $1 LIMIT 1`,
      [id],
    );
    if (mapped.rowCount) {
      res.status(409).json({ error: 'products.deleteInUse' });
      return;
    }
    const row = await query(`DELETE FROM products WHERE id = $1 RETURNING *`, [id]);
    if (!row.rowCount) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    await logAdmin(req, 'product.deleted', {
      detail: { code: row.rows[0].code, name: row.rows[0].name },
    });
    res.json({ ok: true, product: row.rows[0] });
  } catch (e) {
    next(e);
  }
});

// ---------- Site mappings ----------
adminRouter.get('/mappings', async (_req, res, next) => {
  try {
    const rows = await query(
      `SELECT m.*, s.code AS site_code, s.name AS site_name,
              sp.code AS seller_code, sp.legal_name AS seller_name,
              bp.code AS buyer_code, bp.legal_name AS buyer_name,
              p.code AS product_code, p.name AS product_name
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
    const siteId = req.params.siteId;
    if (!seller_party_id || !buyer_party_id || !product_id) {
      res.status(400).json({ error: 'mappings.required', errorKey: 'mappings.required' });
      return;
    }
    if (String(seller_party_id) === String(buyer_party_id)) {
      res.status(400).json({ error: 'mappings.sameParty', errorKey: 'mappings.sameParty' });
      return;
    }

    const siteRow = await query(`SELECT id FROM sites WHERE id = $1`, [siteId]);
    if (!siteRow.rowCount) {
      res.status(404).json({ error: 'mappings.siteNotFound', errorKey: 'mappings.siteNotFound' });
      return;
    }

    const parties = await query(
      `SELECT id, site_id, is_shared, kind FROM parties WHERE id = ANY($1::uuid[])`,
      [[seller_party_id, buyer_party_id]],
    );
    if (parties.rowCount !== 2) {
      res.status(400).json({ error: 'mappings.partyNotFound', errorKey: 'mappings.partyNotFound' });
      return;
    }
    for (const p of parties.rows) {
      const sameSite = String(p.site_id) === String(siteId);
      // Shared parties may be used by any site mapping (site-agnostic)
      const sharedOk = p.is_shared === true;
      if (!sameSite && !sharedOk) {
        res.status(400).json({
          error: 'mappings.partyNotAllowed',
          errorKey: 'mappings.partyNotAllowed',
        });
        return;
      }
    }

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
      [siteId, seller_party_id, buyer_party_id, product_id, !!active],
    );
    await logAdmin(req, 'mapping.saved', {
      siteId,
      detail: { seller_party_id, buyer_party_id, product_id, active: !!active },
    });
    res.json({ mapping: row.rows[0] });
  } catch (e) {
    next(e);
  }
});

adminRouter.delete('/mappings/:siteId', requireHq, async (req, res, next) => {
  try {
    const row = await query(
      `DELETE FROM site_mappings WHERE site_id = $1 RETURNING *`,
      [req.params.siteId],
    );
    if (!row.rowCount) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    await logAdmin(req, 'mapping.deleted', {
      siteId: req.params.siteId,
      detail: { id: row.rows[0].id },
    });
    res.json({ ok: true, mapping: row.rows[0] });
  } catch (e) {
    next(e);
  }
});

// ---------- Invoices (admin) ----------
adminRouter.get('/invoices', async (req, res, next) => {
  try {
    const rawLimit = String(req.query.limit || '50').toLowerCase();
    const wantAll = rawLimit === 'all';
    const limit = wantAll
      ? 20000
      : Math.min(Math.max(Number(rawLimit) || 50, 1), 1000);
    const offset = wantAll ? 0 : Math.max(0, Number(req.query.offset) || 0);
    const site = req.query.site ? String(req.query.site).trim() : null;
    const from = req.query.from ? String(req.query.from).trim() : null;
    const to = req.query.to ? String(req.query.to).trim() : null;
    const qRaw = req.query.q ? String(req.query.q).trim() : '';
    const qFieldRaw = String(req.query.qField || req.query.field || '').toLowerCase();
    const qField =
      qFieldRaw === 'all' ||
      qFieldRaw === 'ticket' ||
      qFieldRaw === 'amount' ||
      qFieldRaw === 'status' ||
      qFieldRaw === 'site' ||
      qFieldRaw === 'invoice_no' ||
      qFieldRaw === 'invoice'
        ? qFieldRaw === 'invoice'
          ? 'invoice_no'
          : qFieldRaw
        : null;
    const q = qField && qRaw ? qRaw : null;
    const kindRaw = String(req.query.kind || req.query.sandbox || 'all').toLowerCase();
    const kind =
      kindRaw === 'simulator' || kindRaw === 'sim'
        ? 'simulator'
        : kindRaw === 'sandbox' || kindRaw === 'yes' || kindRaw === 'true' || kindRaw === '1'
          ? 'sandbox'
          : kindRaw === 'all'
            ? 'all'
            : 'live';

    let statusQ: string | null = null;
    if (q && (qField === 'status' || qField === 'all')) {
      const lower = q.toLowerCase();
      const statusAliases: Array<[string, string[]]> = [
        ['issued', ['issued', '발행', '발급', '発行', 'ออก']],
        ['void', ['void', '삭제', '취소', '取消', 'キャンセル', 'ยกเลิก', 'deleted']],
        ['reissued', ['reissued', 'reissue', '재발급', '재발행', '再発行', 'ออกใหม่', '重开']],
      ];
      const hit = statusAliases.find(([, aliases]) =>
        aliases.some((a) => a.toLowerCase() === lower || lower.includes(a.toLowerCase())),
      );
      statusQ = hit ? hit[0] : lower;
    }

    const filterSql = `WHERE ($1::text IS NULL OR s.code = $1 OR s.name ILIKE '%' || $1 || '%')
         AND ($3::text IS NULL OR i.issued_at >= $3::date)
         AND ($4::text IS NULL OR i.issued_at < ($4::date + interval '1 day'))
         AND (
           $2::text = 'all'
           OR ($2::text = 'simulator' AND i.memo IS NOT NULL AND i.memo LIKE '[SIMULATOR]%')
           OR ($2::text = 'sandbox' AND i.memo IS NOT NULL AND i.memo LIKE '[SANDBOX]%')
           OR (
             $2::text = 'live'
             AND (i.memo IS NULL OR (i.memo NOT LIKE '[SIMULATOR]%' AND i.memo NOT LIKE '[SANDBOX]%'))
           )
         )
         AND (
           $5::text IS NULL
           OR (
             $6::text = 'ticket' AND i.ticket_no ILIKE '%' || $5 || '%'
           )
           OR (
             $6::text = 'amount' AND (
               CAST(i.amount AS TEXT) ILIKE '%' || $5 || '%'
               OR CAST(i.asset_amount AS TEXT) ILIKE '%' || $5 || '%'
             )
           )
           OR (
             $6::text = 'status' AND (
               i.status ILIKE '%' || $5 || '%'
               OR ($7::text IS NOT NULL AND i.status = $7)
             )
           )
           OR (
             $6::text = 'site' AND (
               s.code ILIKE '%' || $5 || '%'
               OR s.name ILIKE '%' || $5 || '%'
             )
           )
           OR (
             $6::text = 'invoice_no' AND i.invoice_no ILIKE '%' || $5 || '%'
           )
           OR (
             $6::text = 'all' AND (
               i.ticket_no ILIKE '%' || $5 || '%'
               OR CAST(i.amount AS TEXT) ILIKE '%' || $5 || '%'
               OR CAST(i.asset_amount AS TEXT) ILIKE '%' || $5 || '%'
               OR i.status ILIKE '%' || $5 || '%'
               OR ($7::text IS NOT NULL AND i.status = $7)
               OR s.code ILIKE '%' || $5 || '%'
               OR s.name ILIKE '%' || $5 || '%'
               OR i.invoice_no ILIKE '%' || $5 || '%'
               OR COALESCE(i.buyer_snapshot->>'legal_name','') ILIKE '%' || $5 || '%'
               OR COALESCE(i.buyer_snapshot->>'code','') ILIKE '%' || $5 || '%'
             )
           )
         )`;
    const filterParams = [site, kind, from, to, q, qField, statusQ];
    const count = await query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM invoices i JOIN sites s ON s.id = i.site_id ${filterSql}`,
      filterParams,
    );
    const rows = await query(
      `SELECT i.*, s.code AS site_code,
              COALESCE(i.buyer_snapshot->>'code', '') AS buyer_code,
              COALESCE(i.seller_snapshot->>'code', '') AS seller_code,
              COALESCE(i.buyer_snapshot->>'legal_name', i.buyer_snapshot->>'trade_name', '') AS buyer_name,
              la.alias AS last_actor_alias,
              la.email AS last_actor_email,
              la.name AS last_actor_name,
              CASE
                WHEN i.memo IS NOT NULL AND i.memo LIKE '[SIMULATOR]%' THEN 'simulator'
                WHEN i.memo IS NOT NULL AND i.memo LIKE '[SANDBOX]%' THEN 'sandbox'
                ELSE 'live'
              END AS invoice_kind
       FROM invoices i
       JOIN sites s ON s.id = i.site_id
       LEFT JOIN admins la ON la.id = i.last_actor_id
       ${filterSql}
       ORDER BY i.issued_at DESC
       LIMIT $8 OFFSET $9`,
      [...filterParams, limit, offset],
    );
    res.json({
      items: rows.rows.map((r) => ({
        ...r,
        invoice_kind: r.invoice_kind,
        is_sandbox: r.invoice_kind === 'sandbox',
        is_simulator: r.invoice_kind === 'simulator',
      })),
      total: Number(count.rows[0]?.c || 0),
      limit,
      offset,
      kind,
      qField,
      q,
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
    const buyers = await query(
      `SELECT id, code, legal_name, kind FROM parties
       WHERE site_id = $1 AND active = TRUE AND kind IN ('buyer', 'both')
       ORDER BY code`,
      [row.rows[0].site_id],
    );
    res.json({ invoice: row.rows[0], items: items.rows, buyers: buyers.rows });
  } catch (e) {
    next(e);
  }
});

/** Edit invoice fields (OTP required). Locked: invoice_no, site, amount, currency, buyer, seller. */
adminRouter.patch('/invoices/:id', requireHq, async (req, res, next) => {
  try {
    if (!(await assertSensitiveOtp(req, res))) return;
    const b = req.body || {};
    const cur = await query(`SELECT * FROM invoices WHERE id = $1`, [req.params.id]);
    if (!cur.rowCount) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    const inv = cur.rows[0];
    if (inv.status === 'void' || inv.deleted_at) {
      res.status(400).json({ error: 'api.error.cannotEditVoid' });
      return;
    }

    const productSnap =
      b.product_snapshot && typeof b.product_snapshot === 'object'
        ? {
            ...((inv.product_snapshot as object) || {}),
            ...b.product_snapshot,
            // keep code if client omits
            code:
              b.product_snapshot.code !== undefined
                ? b.product_snapshot.code
                : (inv.product_snapshot as { code?: string })?.code,
          }
        : inv.product_snapshot;

    const ticketNo = b.ticket_no !== undefined ? String(b.ticket_no) : inv.ticket_no;
    const memo = b.memo !== undefined ? String(b.memo) : inv.memo;
    const asset = b.asset !== undefined ? (b.asset === '' || b.asset == null ? null : String(b.asset)) : inv.asset;
    const assetAmount =
      b.asset_amount !== undefined
        ? b.asset_amount === '' || b.asset_amount == null
          ? null
          : b.asset_amount
        : inv.asset_amount;
    const buyerRef =
      b.buyer_ref !== undefined
        ? b.buyer_ref === '' || b.buyer_ref == null
          ? null
          : String(b.buyer_ref)
        : inv.buyer_ref;

    const row = await query(
      `UPDATE invoices SET
         ticket_no = $2,
         memo = $3,
         asset = $4,
         asset_amount = $5,
         buyer_ref = $6,
         product_snapshot = $7::jsonb,
         updated_at = NOW(),
         content_edited_at = NOW(),
         last_actor_id = $8
       WHERE id = $1
       RETURNING *`,
      [
        req.params.id,
        ticketNo,
        memo,
        asset,
        assetAmount,
        buyerRef,
        JSON.stringify(productSnap),
        req.session.adminId,
      ],
    );

    const p = productSnap as {
      code?: string;
      name?: string;
      description?: string;
      unit?: string;
    };
    await query(`DELETE FROM invoice_items WHERE invoice_id = $1`, [req.params.id]);
    await query(
      `INSERT INTO invoice_items (
         invoice_id, line_no, product_code, description, quantity, unit, unit_price, amount, currency
       ) VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        req.params.id,
        p.code || 'ITEM',
        p.description || p.name || '',
        assetAmount != null ? String(assetAmount) : '1',
        asset || p.unit || 'EA',
        inv.amount,
        inv.amount,
        inv.currency,
      ],
    );

    await logAdmin(req, 'invoice.updated', {
      siteId: row.rows[0].site_id,
      invoiceId: row.rows[0].id,
      detail: {
        invoiceNo: row.rows[0].invoice_no,
        ticketNo: row.rows[0].ticket_no,
        memoChanged: b.memo !== undefined,
        productChanged: !!b.product_snapshot,
        actorId: req.session.adminId,
      },
    });
    res.json({ invoice: row.rows[0] });
  } catch (e) {
    next(e);
  }
});

/** Soft-delete: void the invoice (keep row; mark deleted) */
adminRouter.delete('/invoices/:id', requireHq, async (req, res, next) => {
  try {
    const row = await query(
      `UPDATE invoices SET status = 'void', deleted_at = COALESCE(deleted_at, NOW()),
         updated_at = NOW(), last_actor_id = $2
       WHERE id = $1 AND (status <> 'void' OR deleted_at IS NULL) RETURNING *`,
      [req.params.id, req.session.adminId],
    );
    if (!row.rowCount) {
      res.status(404).json({ error: 'Not found or already void' });
      return;
    }
    await writeAudit({
      eventType: 'invoice.voided',
      actorType: 'admin',
      actorId: req.session.adminId!,
      siteId: row.rows[0].site_id,
      invoiceId: row.rows[0].id,
      detail: { invoiceNo: row.rows[0].invoice_no },
      ip: req.ip,
    });
    res.json({ invoice: row.rows[0] });
  } catch (e) {
    next(e);
  }
});

// ---------- Operation log (audit) ----------
adminRouter.get('/audit', async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const from = req.query.from ? String(req.query.from).trim() : null;
    const to = req.query.to ? String(req.query.to).trim() : null;
    const eventType = req.query.eventType ? String(req.query.eventType).trim() : null;
    const category = req.query.category ? String(req.query.category).trim().toLowerCase() : null;
    const q = req.query.q ? String(req.query.q).trim() : null;

    const categoryPrefix =
      category === 'invoice'
        ? 'invoice.'
        : category === 'admin'
          ? 'admin.'
          : category === 'site'
            ? 'site.'
            : category === 'platform'
              ? 'platform.'
              : category === 'master'
                ? null
                : null;
    const masterFilter = category === 'master';

    const count = await query<{ c: number }>(
      `SELECT COUNT(*)::int AS c
       FROM audit_logs a
       LEFT JOIN sites s ON s.id = a.site_id
       LEFT JOIN invoices i ON i.id = a.invoice_id
       LEFT JOIN admins ad ON a.actor_type = 'admin' AND ad.id::text = a.actor_id
       WHERE ($1::text IS NULL OR a.created_at >= $1::date)
         AND ($2::text IS NULL OR a.created_at < ($2::date + interval '1 day'))
         AND ($3::text IS NULL OR a.event_type = $3)
         AND ($4::text IS NULL OR a.event_type LIKE $4 || '%')
         AND (
           NOT $5::boolean
           OR a.event_type LIKE 'party.%'
           OR a.event_type LIKE 'product.%'
           OR a.event_type LIKE 'mapping.%'
         )
         AND (
           $6::text IS NULL
           OR i.invoice_no ILIKE '%' || $6 || '%'
           OR COALESCE(a.detail_json->>'invoiceNo', '') ILIKE '%' || $6 || '%'
           OR COALESCE(s.code, '') ILIKE '%' || $6 || '%'
           OR COALESCE(ad.email, '') ILIKE '%' || $6 || '%'
           OR COALESCE(ad.alias, '') ILIKE '%' || $6 || '%'
           OR COALESCE(ad.name, '') ILIKE '%' || $6 || '%'
           OR COALESCE(a.actor_id, '') ILIKE '%' || $6 || '%'
           OR a.event_type ILIKE '%' || $6 || '%'
         )`,
      [from, to, eventType, categoryPrefix, masterFilter, q],
    );

    const rows = await query(
      `SELECT a.id, a.event_type, a.actor_type, a.actor_id, a.site_id, a.invoice_id,
              a.detail_json, a.ip, a.created_at,
              s.code AS site_code, s.name AS site_name,
              i.invoice_no,
              CASE
                WHEN a.actor_type = 'admin' THEN COALESCE(NULLIF(ad.alias, ''), ad.name, ad.email, a.actor_id)
                WHEN a.actor_type = 'site' THEN COALESCE(s.code, a.actor_id)
                ELSE COALESCE(a.actor_id, 'system')
              END AS actor_label,
              CASE WHEN a.actor_type = 'admin' THEN ad.email ELSE NULL END AS actor_email,
              CASE WHEN a.actor_type = 'admin' THEN ad.alias ELSE NULL END AS actor_alias
       FROM audit_logs a
       LEFT JOIN sites s ON s.id = a.site_id
       LEFT JOIN invoices i ON i.id = a.invoice_id
       LEFT JOIN admins ad ON a.actor_type = 'admin' AND ad.id::text = a.actor_id
       WHERE ($1::text IS NULL OR a.created_at >= $1::date)
         AND ($2::text IS NULL OR a.created_at < ($2::date + interval '1 day'))
         AND ($3::text IS NULL OR a.event_type = $3)
         AND ($4::text IS NULL OR a.event_type LIKE $4 || '%')
         AND (
           NOT $5::boolean
           OR a.event_type LIKE 'party.%'
           OR a.event_type LIKE 'product.%'
           OR a.event_type LIKE 'mapping.%'
         )
         AND (
           $6::text IS NULL
           OR i.invoice_no ILIKE '%' || $6 || '%'
           OR COALESCE(a.detail_json->>'invoiceNo', '') ILIKE '%' || $6 || '%'
           OR COALESCE(s.code, '') ILIKE '%' || $6 || '%'
           OR COALESCE(ad.email, '') ILIKE '%' || $6 || '%'
           OR COALESCE(ad.alias, '') ILIKE '%' || $6 || '%'
           OR COALESCE(ad.name, '') ILIKE '%' || $6 || '%'
           OR COALESCE(a.actor_id, '') ILIKE '%' || $6 || '%'
           OR a.event_type ILIKE '%' || $6 || '%'
         )
       ORDER BY a.created_at DESC
       LIMIT $7 OFFSET $8`,
      [from, to, eventType, categoryPrefix, masterFilter, q, limit, offset],
    );

    res.json({
      total: count.rows[0]?.c ?? 0,
      limit,
      offset,
      items: rows.rows,
    });
  } catch (e) {
    next(e);
  }
});

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

// ---------- Merged invoices (인보이스통합) ----------
adminRouter.get('/merged/candidates', async (req, res, next) => {
  try {
    const siteId = String(req.query.siteId || req.query.site || '').trim();
    const from = String(req.query.from || req.query.date || '').trim();
    const to = String(req.query.to || req.query.date || '').trim();
    const sellerCode = String(req.query.sellerCode || req.query.seller || '').trim();
    const buyerCode = String(req.query.buyerCode || req.query.buyer || '').trim();
    if (!from || !to) {
      res.status(400).json({ error: 'merged.candidatesRequired', errorKey: 'merged.candidatesRequired' });
      return;
    }
    const data = await listMergedCandidates({
      siteId: siteId || null,
      from,
      to,
      sellerCode: sellerCode || null,
      buyerCode: buyerCode || null,
    });
    res.json(data);
  } catch (e) {
    const err = e as { status?: number; errorKey?: string; message?: string };
    if (err.status) {
      res.status(err.status).json({ error: err.message, errorKey: err.errorKey || err.message });
      return;
    }
    next(e);
  }
});

adminRouter.get('/merged', async (req, res, next) => {
  try {
    const data = await listMerged({
      site: req.query.site ? String(req.query.site) : null,
      from: req.query.from ? String(req.query.from) : null,
      to: req.query.to ? String(req.query.to) : null,
      q: req.query.q ? String(req.query.q) : null,
      includeDeleted: String(req.query.includeDeleted || '') === '1',
    });
    res.json(data);
  } catch (e) {
    next(e);
  }
});

adminRouter.get('/merged/:id', async (req, res, next) => {
  try {
    const detail = await getMergedDetail(String(req.params.id));
    if (!detail) {
      res.status(404).json({ error: 'merged.notFound', errorKey: 'merged.notFound' });
      return;
    }
    res.json(detail);
  } catch (e) {
    next(e);
  }
});

adminRouter.get('/merged/:id/pdf', async (req, res, next) => {
  try {
    const detail = await getMergedDetail(String(req.params.id));
    if (!detail) {
      res.status(404).json({ error: 'merged.notFound', errorKey: 'merged.notFound' });
      return;
    }
    const abs = mergedPdfAbsPath(detail.merged.pdf_path);
    if (!abs || !fs.existsSync(abs)) {
      res.status(404).json({ error: 'merged.pdfMissing', errorKey: 'merged.pdfMissing' });
      return;
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${encodeURIComponent(detail.merged.invoice_no)}.pdf"`,
    );
    fs.createReadStream(abs).pipe(res);
  } catch (e) {
    next(e);
  }
});

adminRouter.post('/merged', requireHq, async (req, res, next) => {
  try {
    const b = req.body || {};
    const siteId = String(b.siteId || b.site_id || '').trim();
    const from = String(b.from || b.date || '').trim() || null;
    const to = String(b.to || b.date || '').trim() || null;
    const sourceIds = Array.isArray(b.sourceIds)
      ? b.sourceIds.map(String)
      : Array.isArray(b.source_ids)
        ? b.source_ids.map(String)
        : [];
    const mode: MergedMode = b.mode === 'total' ? 'total' : 'lines';
    const result = await createMergedInvoice({
      siteId,
      from,
      to,
      sourceIds,
      mode,
      actorId: req.session?.adminId || null,
    });
    await logAdmin(req, 'merged.created', {
      siteId,
      detail: {
        invoiceNo: result.merged.invoice_no,
        mode,
        sourceIds,
        from,
        to,
        amount: result.merged.amount,
      },
    });
    res.status(201).json(result);
  } catch (e) {
    const err = e as { status?: number; errorKey?: string; message?: string };
    if (err.status) {
      res.status(err.status).json({ error: err.message, errorKey: err.errorKey || err.message });
      return;
    }
    next(e);
  }
});

adminRouter.post('/merged/:id/revisions', requireHq, async (req, res, next) => {
  try {
    if (!(await assertSensitiveOtp(req, res))) return;
    const b = req.body || {};
    const items = Array.isArray(b.items) ? b.items : [];
    const result = await createMergedRevision({
      fromId: String(req.params.id),
      actorId: req.session?.adminId || null,
      currency: b.currency,
      amount: b.amount,
      mode: b.mode,
      seller_snapshot: b.seller_snapshot,
      buyer_snapshot: b.buyer_snapshot,
      product_snapshot: b.product_snapshot,
      memo: b.memo,
      ticket_no: b.ticket_no,
      asset: b.asset,
      asset_amount: b.asset_amount,
      buyer_ref: b.buyer_ref,
      issued_at: b.issued_at,
      items,
    });
    await logAdmin(req, 'merged.revision', {
      siteId: result.merged.site_id,
      detail: {
        fromId: req.params.id,
        invoiceNo: result.merged.invoice_no,
        revisionNo: result.merged.revision_no,
      },
    });
    res.status(201).json(result);
  } catch (e) {
    const err = e as { status?: number; errorKey?: string; message?: string };
    if (err.status) {
      res.status(err.status).json({ error: err.message, errorKey: err.errorKey || err.message });
      return;
    }
    next(e);
  }
});

adminRouter.delete('/merged/:id', requireHq, async (req, res, next) => {
  try {
    const row = await softDeleteMerged(String(req.params.id), req.session?.adminId || null);
    await logAdmin(req, 'merged.deleted', {
      siteId: row.site_id,
      detail: {
        invoiceNo: row.invoice_no,
        revisionNo: row.revision_no,
        kind: Number(row.revision_no) === 1 ? 'original' : 'revision',
      },
    });
    res.json({ merged: row });
  } catch (e) {
    const err = e as { status?: number; errorKey?: string; message?: string };
    if (err.status) {
      res.status(err.status).json({ error: err.message, errorKey: err.errorKey || err.message });
      return;
    }
    next(e);
  }
});
