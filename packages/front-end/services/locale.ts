export const supportedLanguages = [
  "en",
  "es",
  "de",
  "it",
  "ja",
  "zh",
  "fr",
  "pl",
  "pt",
  "ru",
  "hi",
  "tr",
  "ko",
] as const;
export type SupportedLanguage = (typeof supportedLanguages)[number];

export const defaultLanguage: SupportedLanguage = "en";

export const LOCALE_STORAGE_KEY = "gb_ui_locale";

// Each language's name in that language, so a picker reads the same in any UI language.
export const languageNativeLabels: Record<SupportedLanguage, string> = {
  en: "English",
  es: "Español",
  de: "Deutsch",
  it: "Italiano",
  ja: "日本語",
  zh: "中文",
  fr: "Français",
  pl: "Polski",
  pt: "Português",
  ru: "Русский",
  hi: "हिन्दी",
  tr: "Türkçe",
  ko: "한국어",
};

function isSupportedLanguage(value: string): value is SupportedLanguage {
  return (supportedLanguages as readonly string[]).includes(value);
}

export function resolveLanguage(
  locale: string | null | undefined,
): SupportedLanguage {
  if (!locale) return defaultLanguage;
  const language = locale.toLowerCase().split(/[-_]/)[0];
  return isSupportedLanguage(language) ? language : defaultLanguage;
}
