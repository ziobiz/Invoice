import fs from 'node:fs';
import path from 'node:path';
import type { Response } from 'express';
import { getPlatformConfig, savePlatformConfig, type PlatformConfig } from './platform.js';
import { config } from '../config.js';

export type BrandAsset = 'logo' | 'auth-logo' | 'favicon' | 'background' | 'og';

const BRANDING_DIR = path.resolve(process.env.UPLOAD_DIR ?? './uploads', 'branding');

export const BRAND_ASSET_URL: Record<BrandAsset, string> = {
  logo: '/api/branding/logo',
  'auth-logo': '/api/branding/auth-logo',
  favicon: '/api/branding/favicon',
  background: '/api/branding/background',
  og: '/api/branding/og',
};

const BRAND_CONFIG_KEY: Record<BrandAsset, keyof PlatformConfig> = {
  logo: 'logoUrl',
  'auth-logo': 'authLogoUrl',
  favicon: 'faviconUrl',
  background: 'authBackgroundUrl',
  og: 'ogImageUrl',
};

function ensureBrandingDir() {
  if (!fs.existsSync(BRANDING_DIR)) fs.mkdirSync(BRANDING_DIR, { recursive: true });
}

export function getBrandingAssetPath(asset: BrandAsset): string | null {
  if (!fs.existsSync(BRANDING_DIR)) return null;
  const files = fs.readdirSync(BRANDING_DIR).filter((f) => f.startsWith(`${asset}.`));
  if (!files.length) return null;
  return path.resolve(BRANDING_DIR, files[0]!);
}

export function syncBrandingUrls(cfg: PlatformConfig): PlatformConfig {
  const next = { ...cfg };
  for (const asset of Object.keys(BRAND_ASSET_URL) as BrandAsset[]) {
    if (getBrandingAssetPath(asset)) {
      (next as Record<string, unknown>)[BRAND_CONFIG_KEY[asset] as string] = BRAND_ASSET_URL[asset];
    }
  }
  return next;
}

function withCacheBust(url: string | null | undefined, asset: BrandAsset): string | null {
  if (!url) return null;
  const filePath = getBrandingAssetPath(asset);
  const base = url.split('?')[0]!;
  if (!filePath) return base;
  return `${base}?v=${fs.statSync(filePath).mtimeMs}`;
}

function publicBase(cfg: PlatformConfig): string {
  const fromEnv = (config.publicBaseUrl || '').replace(/\/$/, '');
  if (fromEnv) return fromEnv;
  const domain = (cfg.publicDomain || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  return domain ? `https://${domain}` : '';
}

export type PublicBranding = {
  siteName: string;
  tabTitle: string;
  ogTitle: string;
  ogDescription: string;
  logoUrl: string | null;
  authLogoUrl: string | null;
  faviconUrl: string | null;
  authBackgroundUrl: string | null;
  ogImageUrl: string | null;
  authMainText: string;
  footerText: string;
  publicDomain: string;
  absoluteOgImageUrl: string | null;
  linkPreviewRevision: number;
};

export async function getPublicBranding(): Promise<PublicBranding> {
  const raw = syncBrandingUrls(await getPlatformConfig());
  const siteName = raw.siteName || 'Invoice Service';
  const tabTitle = (raw.tabTitle || siteName).trim() || siteName;
  const ogTitle = (raw.ogTitle || siteName).trim() || siteName;
  const ogDescription = (raw.ogDescription || '').trim();
  const base = publicBase(raw);
  const ogPath = withCacheBust(raw.ogImageUrl || raw.authLogoUrl, raw.ogImageUrl ? 'og' : 'auth-logo');
  return {
    siteName,
    tabTitle,
    ogTitle,
    ogDescription,
    logoUrl: withCacheBust(raw.logoUrl, 'logo'),
    authLogoUrl: withCacheBust(raw.authLogoUrl, 'auth-logo'),
    faviconUrl: withCacheBust(raw.faviconUrl, 'favicon'),
    authBackgroundUrl: withCacheBust(raw.authBackgroundUrl, 'background'),
    ogImageUrl: withCacheBust(raw.ogImageUrl, 'og'),
    authMainText: raw.authMainText || '',
    footerText: raw.footerText || '',
    publicDomain: raw.publicDomain || '',
    absoluteOgImageUrl: ogPath && base ? `${base}${ogPath}` : null,
    linkPreviewRevision: Number(raw.linkPreviewRevision || 0),
  };
}

export async function saveBrandingAsset(
  asset: BrandAsset,
  file: { buffer: Buffer; originalname: string },
): Promise<PlatformConfig> {
  ensureBrandingDir();
  const defaults: Record<BrandAsset, string> = {
    logo: '.png',
    'auth-logo': '.png',
    favicon: '.ico',
    background: '.jpg',
    og: '.png',
  };
  const ext = path.extname(file.originalname) || defaults[asset];
  for (const f of fs.readdirSync(BRANDING_DIR)) {
    if (f.startsWith(`${asset}.`)) fs.unlinkSync(path.join(BRANDING_DIR, f));
  }
  fs.writeFileSync(path.join(BRANDING_DIR, `${asset}${ext}`), file.buffer);
  const patch: Partial<PlatformConfig> = {
    [BRAND_CONFIG_KEY[asset]]: BRAND_ASSET_URL[asset],
  } as Partial<PlatformConfig>;
  if (asset === 'og') {
    const cur = await getPlatformConfig();
    patch.linkPreviewRevision = Number(cur.linkPreviewRevision || 0) + 1;
  }
  return savePlatformConfig(patch);
}

function mimeFromExt(ext: string): string {
  const map: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.ico': 'image/x-icon',
    '.svg': 'image/svg+xml',
  };
  return map[ext.toLowerCase()] ?? 'application/octet-stream';
}

export function sendBrandingFile(res: Response, asset: BrandAsset): void {
  const filePath = getBrandingAssetPath(asset);
  if (!filePath) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.setHeader('Content-Type', mimeFromExt(path.extname(filePath)));
  res.sendFile(filePath);
}

/** Inject OG/meta/favicon into admin.html for crawlers (LINE etc.) */
export async function buildAdminHtml(templateHtml: string): Promise<string> {
  const b = await getPublicBranding();
  const cfg = await getPlatformConfig();
  const base = publicBase(cfg) || '';
  const pageUrl = base ? `${base}/admin` : '/admin';
  const title = escapeHtml(b.tabTitle);
  const ogTitle = escapeHtml(b.ogTitle);
  const ogDesc = escapeHtml(b.ogDescription || b.siteName);
  const ogImage = b.absoluteOgImageUrl ? escapeHtml(b.absoluteOgImageUrl) : '';
  const favicon = b.faviconUrl ? escapeHtml(b.faviconUrl) : '';

  const metaBlock = [
    favicon ? `<link rel="icon" href="${favicon}" />` : '',
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${escapeHtml(b.siteName)}" />`,
    `<meta property="og:title" content="${ogTitle}" />`,
    `<meta property="og:description" content="${ogDesc}" />`,
    `<meta property="og:url" content="${escapeHtml(pageUrl)}" />`,
    ogImage ? `<meta property="og:image" content="${ogImage}" />` : '',
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${ogTitle}" />`,
    `<meta name="twitter:description" content="${ogDesc}" />`,
    ogImage ? `<meta name="twitter:image" content="${ogImage}" />` : '',
    `<meta name="description" content="${ogDesc}" />`,
  ]
    .filter(Boolean)
    .join('\n  ');

  let html = templateHtml;
  if (/<title>[^<]*<\/title>/i.test(html)) {
    html = html.replace(/<title>[^<]*<\/title>/i, `<title>${title}</title>`);
  } else {
    html = html.replace('</head>', `  <title>${title}</title>\n</head>`);
  }
  // Inject brand meta after charset/viewport block (before stylesheet)
  if (html.includes('<!-- BRAND_META -->')) {
    html = html.replace('<!-- BRAND_META -->', metaBlock);
  } else if (html.includes('<link rel="stylesheet"')) {
    html = html.replace('<link rel="stylesheet"', `${metaBlock}\n  <link rel="stylesheet"`);
  } else {
    html = html.replace('</head>', `  ${metaBlock}\n</head>`);
  }
  return html;
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
