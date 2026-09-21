import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SUPPORTED_LOCALES = ['ko', 'en', 'ja', 'th', 'zh'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadLocale(code: Locale): Record<string, string> {
  const file = path.join(__dirname, 'locales', `${code}.json`);
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, string>;
}

const catalogs: Record<Locale, Record<string, string>> = {
  en: loadLocale('en'),
  ko: loadLocale('ko'),
  ja: loadLocale('ja'),
  th: loadLocale('th'),
  zh: loadLocale('zh'),
};

export function resolveLocale(input?: string | null): Locale {
  if (!input) return DEFAULT_LOCALE;
  const primary = input.split(',')[0]?.trim().split(';')[0]?.trim().toLowerCase() ?? '';
  const short = primary.slice(0, 2);
  if (SUPPORTED_LOCALES.includes(short as Locale)) return short as Locale;
  return DEFAULT_LOCALE;
}

export function t(
  locale: Locale,
  key: string,
  vars?: Record<string, string | number>,
): string {
  const table = catalogs[locale] ?? catalogs.en;
  let text = table[key] ?? catalogs.en[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replaceAll(`{${k}}`, String(v));
    }
  }
  return text;
}

export function localeFromRequest(headers: {
  acceptLanguage?: string | null;
  langQuery?: string | null;
}): Locale {
  return resolveLocale(headers.langQuery || headers.acceptLanguage);
}
