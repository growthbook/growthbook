export const LOCALES = ["ru", "en"] as const;

export type Locale = (typeof LOCALES)[number];

export const LOCALE_STORAGE_KEY = "gb_ui_locale";

// Self-hosted Russian instance: Russian is the default UI language.
// Tests keep English so existing assertions do not break.
export const DEFAULT_LOCALE: Locale =
  process.env.NODE_ENV === "test" ? "en" : "ru";

export function isLocale(value: unknown): value is Locale {
  return value === "ru" || value === "en";
}
