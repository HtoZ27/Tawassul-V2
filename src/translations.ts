import en from "./i18n/en.json" with { type: "json" };
import ar from "./i18n/ar.json" with { type: "json" };

export const LANGUAGES = ["en", "ar"] as const;

export type Lang = (typeof LANGUAGES)[number];

const LOCALE_MAP: Record<string, Lang> = {
  en: "en",
  ar: "ar",
};

function detectLanguage(): Lang {
  const raw = process?.env?.LC_ALL ?? process?.env?.LC_MESSAGES ?? process?.env?.LANG ?? process?.env?.LANGUAGE;
  if (!raw) return "en";
  const langCode = raw.split(/[_.:]/)[0]?.toLowerCase() || "";
  return LOCALE_MAP[langCode] ?? "en";
}

let currentLang: Lang = detectLanguage();

export function setLanguage(lang: Lang) {
  currentLang = lang;
}
export function getLanguage(): Lang {
  return currentLang;
}

const _localeCache: Record<string, Record<string, string>> = {
  en,
  ar,
};

export async function loadLocale(lang: string): Promise<Record<string, string>> {
  if (_localeCache[lang]) return _localeCache[lang]!;
  const normalized = LOCALE_MAP[lang];
  if (!normalized) {
    _localeCache[lang] = {};
    return _localeCache[lang]!;
  }
  return _localeCache[lang] ?? {};
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function resolveParams(val: string, params?: Record<string, string>): string {
  if (!params) return val;
  let result = val;
  for (const [k, v] of Object.entries(params)) {
    result = result.replace(new RegExp(`\\{${escapeRegex(k)}\\}`, "g"), () => v);
  }
  return result;
}

export function t(key: string, params?: Record<string, string>, lang?: Lang): string {
  const locale = _localeCache[lang ?? currentLang];
  const val = locale?.[key];
  if (val !== undefined) return resolveParams(val, params);
  return `[missing: ${key}]`;
}

export function recordTypeLabel(type: string, severity?: string): string {
  const severitySuffix = severity ? ` (${severity})` : "";
  const key =
    type === "fix"
      ? "recordTypeFix"
      : type === "incident"
        ? "recordTypeIncident"
        : type === "decision"
          ? "recordTypeDecision"
          : "recordTypeNote";
  return resolveParams(t(key), { severity: severitySuffix });
}