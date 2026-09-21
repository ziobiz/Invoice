import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

/** Mutually exclusive PDF seal display modes (never all three together). */
export type SealDisplayMode =
  | 'official_stamp' // 회사직인 + 도장
  | 'official' // 회사직인만
  | 'signature_stamp' // 서명 + 도장
  | 'signature' // 서명만
  | 'stamp'; // 도장만

export type SiteSealConfig = {
  companyName: string;
  signatoryName?: string | null;
  signatoryTitle?: string | null;
  officialPath?: string | null;
  stampPath?: string | null;
  signaturePath?: string | null;
  useOfficial: boolean;
  useStamp: boolean;
  useSignature: boolean;
  /** Resolved exclusive display mode */
  displayMode: SealDisplayMode;
};

export function flagsFromSealMode(mode: SealDisplayMode): {
  useOfficial: boolean;
  useStamp: boolean;
  useSignature: boolean;
} {
  switch (mode) {
    case 'official_stamp':
      return { useOfficial: true, useStamp: true, useSignature: false };
    case 'official':
      return { useOfficial: true, useStamp: false, useSignature: false };
    case 'signature_stamp':
      return { useOfficial: false, useStamp: true, useSignature: true };
    case 'signature':
      return { useOfficial: false, useStamp: false, useSignature: true };
    case 'stamp':
      return { useOfficial: false, useStamp: true, useSignature: false };
    default:
      return { useOfficial: true, useStamp: true, useSignature: false };
  }
}

/** Map stored flags → exclusive mode (never all three). */
export function resolveSealDisplayMode(flags: {
  useOfficial: boolean;
  useStamp: boolean;
  useSignature: boolean;
}): SealDisplayMode {
  const { useOfficial: o, useStamp: s, useSignature: g } = flags;
  if (o && s && !g) return 'official_stamp';
  if (o && !s && !g) return 'official';
  if (!o && s && g) return 'signature_stamp';
  if (!o && !s && g) return 'signature';
  if (!o && s && !g) return 'stamp';
  if (o && s && g) return 'official_stamp';
  if (o && g && !s) return 'official';
  if (o) return 'official';
  if (g && s) return 'signature_stamp';
  if (g) return 'signature';
  if (s) return 'stamp';
  return 'official_stamp';
}

export type SiteSealRow = {
  code: string;
  name: string;
  seal_official_path?: string | null;
  seal_stamp_path?: string | null;
  seal_signature_path?: string | null;
  signatory_name?: string | null;
  signatory_title?: string | null;
  seal_use_official?: boolean | null;
  seal_use_stamp?: boolean | null;
  seal_use_signature?: boolean | null;
  pdf_payment_date_offset?: number | null;
  pdf_payment_terms?: string | null;
  pdf_payment_due?: string | null;
  pdf_remarks_notice?: string | null;
  pdf_remarks_enabled?: boolean | null;
  pdf_notice_enabled?: boolean | null;
  pdf_notice_text?: string | null;
  pdf_notice_ac_no?: string | null;
  pdf_notice_ac_name?: string | null;
  pdf_notice_bank_add?: string | null;
  pdf_notice_swift?: string | null;
  pdf_notice_slot?: string | null;
  pdf_notice_a_name?: string | null;
  pdf_notice_a_text?: string | null;
  pdf_notice_a_ac_no?: string | null;
  pdf_notice_a_ac_name?: string | null;
  pdf_notice_a_bank_add?: string | null;
  pdf_notice_a_swift?: string | null;
  pdf_notice_a_bank_name?: string | null;
  pdf_notice_a_address?: string | null;
  pdf_notice_a_bank_code?: string | null;
  pdf_notice_a_branch_code?: string | null;
  pdf_notice_a_account_type?: string | null;
  pdf_notice_a_account_number?: string | null;
  pdf_notice_a_account_holder?: string | null;
  pdf_notice_b_name?: string | null;
  pdf_notice_b_text?: string | null;
  pdf_notice_b_ac_no?: string | null;
  pdf_notice_b_ac_name?: string | null;
  pdf_notice_b_bank_add?: string | null;
  pdf_notice_b_swift?: string | null;
  pdf_notice_b_bank_name?: string | null;
  pdf_notice_b_address?: string | null;
  pdf_notice_b_bank_code?: string | null;
  pdf_notice_b_branch_code?: string | null;
  pdf_notice_b_account_type?: string | null;
  pdf_notice_b_account_number?: string | null;
  pdf_notice_b_account_holder?: string | null;
  pdf_notice_c_name?: string | null;
  pdf_notice_c_text?: string | null;
  pdf_notice_c_ac_no?: string | null;
  pdf_notice_c_ac_name?: string | null;
  pdf_notice_c_bank_add?: string | null;
  pdf_notice_c_swift?: string | null;
  pdf_notice_c_bank_name?: string | null;
  pdf_notice_c_address?: string | null;
  pdf_notice_c_bank_code?: string | null;
  pdf_notice_c_branch_code?: string | null;
  pdf_notice_c_account_type?: string | null;
  pdf_notice_c_account_number?: string | null;
  pdf_notice_c_account_holder?: string | null;
  pdf_line_slot?: string | null;
  pdf_line_a_name?: string | null;
  pdf_line_a_item?: string | null;
  pdf_line_a_description?: string | null;
  pdf_line_a_unit_label?: string | null;
  pdf_line_a_hide_unit_price?: boolean | null;
  pdf_line_b_name?: string | null;
  pdf_line_b_item?: string | null;
  pdf_line_b_description?: string | null;
  pdf_line_b_unit_label?: string | null;
  pdf_line_b_hide_unit_price?: boolean | null;
  pdf_line_c_name?: string | null;
  pdf_line_c_item?: string | null;
  pdf_line_c_description?: string | null;
  pdf_line_c_unit_label?: string | null;
  pdf_line_c_hide_unit_price?: boolean | null;
};

export type NoticeSlot = 'off' | 'a' | 'b' | 'c';
export type LineSlot = NoticeSlot;

/** Site-level Payment / Remarks / Notice / Line defaults for PDF */
export type SitePdfDefaults = {
  paymentDateOffset: number;
  paymentTerms: string | null;
  paymentDue: string | null;
  remarksNotice: string | null;
  remarksEnabled: boolean;
  noticeEnabled: boolean;
  noticeSlot: NoticeSlot;
  /** Admin-only preset label (e.g. Payoneer) — never used as PDF heading */
  noticeLabel: string | null;
  noticeText: string | null;
  noticeBankName: string | null;
  noticeAddress: string | null;
  noticeBankCode: string | null;
  noticeBranchCode: string | null;
  noticeAccountType: string | null;
  noticeAccountNumber: string | null;
  noticeAccountHolder: string | null;
  /** Line item text preset (off = original product values) */
  lineSlot: LineSlot;
  lineLabel: string | null;
  lineItem: string | null;
  lineDescription: string | null;
  /** Unit text only; empty string = quantity number alone; null when slot off */
  lineUnitLabel: string | null;
  lineHideUnitPrice: boolean;
};

function resolveNoticeSlot(raw?: string | null, legacyEnabled?: boolean | null): NoticeSlot {
  const s = String(raw || '').toLowerCase();
  if (s === 'a' || s === 'b' || s === 'c') return s;
  if (legacyEnabled === true) return 'a';
  return 'off';
}

function trimOrNull(v?: string | null): string | null {
  const s = String(v ?? '').trim();
  return s ? s : null;
}

export function pdfDefaultsFromSite(site: SiteSealRow | null | undefined): SitePdfDefaults {
  const offset = Number(site?.pdf_payment_date_offset);
  const slot = resolveNoticeSlot(site?.pdf_notice_slot, site?.pdf_notice_enabled);
  const pick = (key: 'a' | 'b' | 'c') => {
    const g = (suffix: string) =>
      trimOrNull(site?.[`pdf_notice_${key}_${suffix}` as keyof SiteSealRow] as string | null | undefined);
    return {
      label: g('name'),
      text: g('text'),
      bankName: g('bank_name'),
      address: g('address') || g('bank_add'),
      bankCode: g('bank_code'),
      branchCode: g('branch_code'),
      accountType: g('account_type'),
      accountNumber: g('account_number') || g('ac_no'),
      accountHolder: g('account_holder') || g('ac_name'),
    };
  };
  const active =
    slot === 'a' ? pick('a') : slot === 'b' ? pick('b') : slot === 'c' ? pick('c') : null;
  // Legacy fallback for slot a if new cols empty
  const noticeText =
    active?.text || (slot === 'a' ? trimOrNull(site?.pdf_notice_text) : null);
  const noticeAccountNumber =
    active?.accountNumber ||
    (slot === 'a' ? trimOrNull(site?.pdf_notice_ac_no) : null);
  const noticeAccountHolder =
    active?.accountHolder ||
    (slot === 'a' ? trimOrNull(site?.pdf_notice_ac_name) : null);
  const noticeAddress =
    active?.address || (slot === 'a' ? trimOrNull(site?.pdf_notice_bank_add) : null);

  const lineSlot = resolveNoticeSlot(site?.pdf_line_slot, false);
  const pickLine = (key: 'a' | 'b' | 'c') => {
    const g = (suffix: string) =>
      trimOrNull(site?.[`pdf_line_${key}_${suffix}` as keyof SiteSealRow] as string | null | undefined);
    const hide = site?.[`pdf_line_${key}_hide_unit_price` as keyof SiteSealRow];
    return {
      label: g('name'),
      item: g('item'),
      description: g('description'),
      // allow empty string for "number only"
      unitLabel:
        site?.[`pdf_line_${key}_unit_label` as keyof SiteSealRow] != null
          ? String(site[`pdf_line_${key}_unit_label` as keyof SiteSealRow] ?? '')
          : null,
      hideUnitPrice: hide === true,
    };
  };
  const lineActive =
    lineSlot === 'a' ? pickLine('a') : lineSlot === 'b' ? pickLine('b') : lineSlot === 'c' ? pickLine('c') : null;

  return {
    paymentDateOffset: Number.isFinite(offset) && offset >= 0 ? Math.min(offset, 365) : 3,
    paymentTerms: trimOrNull(site?.pdf_payment_terms),
    paymentDue: trimOrNull(site?.pdf_payment_due),
    remarksNotice: trimOrNull(site?.pdf_remarks_notice),
    remarksEnabled: site?.pdf_remarks_enabled !== false,
    noticeEnabled: slot !== 'off',
    noticeSlot: slot,
    noticeLabel: active?.label || null,
    noticeText,
    noticeBankName: active?.bankName || null,
    noticeAddress,
    noticeBankCode: active?.bankCode || null,
    noticeBranchCode: active?.branchCode || null,
    noticeAccountType: active?.accountType || null,
    noticeAccountNumber,
    noticeAccountHolder,
    lineSlot,
    lineLabel: lineActive?.label || null,
    lineItem: lineActive?.item || null,
    lineDescription: lineActive?.description || null,
    lineUnitLabel: lineActive ? (lineActive.unitLabel ?? '') : null,
    lineHideUnitPrice: lineActive?.hideUnitPrice === true,
  };
}

const KINDS = ['official', 'stamp', 'signature'] as const;
export type SealAssetKind = (typeof KINDS)[number];

export function isSealAssetKind(v: string): v is SealAssetKind {
  return (KINDS as readonly string[]).includes(v);
}

export function sealConfigFromSite(
  site: SiteSealRow,
  companyNameFallback?: string | null,
): SiteSealConfig {
  const raw = {
    useOfficial: site.seal_use_official !== false,
    useStamp: site.seal_use_stamp !== false,
    useSignature: site.seal_use_signature !== false,
  };
  const displayMode = resolveSealDisplayMode(raw);
  const flags = flagsFromSealMode(displayMode);
  return {
    companyName: companyNameFallback || site.name || site.code,
    signatoryName: site.signatory_name || null,
    signatoryTitle: site.signatory_title || 'CEO',
    officialPath: resolveSealAbs(site.seal_official_path),
    stampPath: resolveSealAbs(site.seal_stamp_path),
    signaturePath: resolveSealAbs(site.seal_signature_path),
    ...flags,
    displayMode,
  };
}

export function resolveSealAbs(rel?: string | null): string | null {
  if (!rel) return null;
  const abs = path.isAbsolute(rel) ? rel : path.join(config.sealStorageDir, rel);
  return fs.existsSync(abs) ? abs : null;
}

export function ensureSealDir(siteCode: string): string {
  const dir = path.join(config.sealStorageDir, siteCode.toLowerCase());
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Returns relative path under sealStorageDir */
export function saveSealAsset(
  siteCode: string,
  kind: SealAssetKind,
  sourcePath: string,
  originalName: string,
): string {
  const dir = ensureSealDir(siteCode);
  const ext = path.extname(originalName || '').toLowerCase() || '.png';
  const safeExt = ['.png', '.jpg', '.jpeg', '.webp'].includes(ext) ? ext : '.png';
  const fileName = `${kind}${safeExt}`;
  const dest = path.join(dir, fileName);
  fs.copyFileSync(sourcePath, dest);
  return path.join(siteCode.toLowerCase(), fileName).replace(/\\/g, '/');
}
