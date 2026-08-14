import {
  createContext,
  FC,
  PropsWithChildren,
  ReactNode,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import { setSharedUiLocale } from "shared/dates";
import {
  DEFAULT_LOCALE,
  isLocale,
  Locale,
  LOCALE_STORAGE_KEY,
} from "@/locales/types";
import { ru } from "@/locales/ru";

const dictionaries: Record<Locale, Record<string, string>> = {
  ru,
  en: {},
};

let currentLocale: Locale = DEFAULT_LOCALE;

export function getUiLocale(): Locale {
  return currentLocale;
}

export function cronLocale(): "ru" | "en" {
  return currentLocale === "ru" ? "ru" : "en";
}

function interpolate(
  template: string,
  vars?: Record<string, string | number>,
): string {
  if (!vars) return template;
  let out = template;
  for (const [key, value] of Object.entries(vars)) {
    out = out.split(`{{${key}}}`).join(String(value));
  }
  return out;
}

export function translate(
  key: string,
  vars?: Record<string, string | number>,
  locale: Locale = currentLocale,
): string {
  if (!key) return key;
  const dict = dictionaries[locale];
  return interpolate(dict[key] ?? key, vars);
}

function readStoredLocale(): Locale {
  if (typeof window === "undefined") return DEFAULT_LOCALE;
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (isLocale(stored)) return stored;
  } catch {
    // Privacy mode can block localStorage.
  }
  return DEFAULT_LOCALE;
}

function persistLocale(locale: Locale) {
  currentLocale = locale;
  setSharedUiLocale(locale);
  if (typeof document !== "undefined") {
    document.documentElement.lang = locale;
  }
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Ignore quota / privacy errors.
  }
}

type LocaleContextType = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
  tx: (value: ReactNode) => ReactNode;
};

const LocaleContext = createContext<LocaleContextType>({
  locale: DEFAULT_LOCALE,
  setLocale: () => undefined,
  t: (key, vars) => translate(key, vars, DEFAULT_LOCALE),
  tx: (value) =>
    typeof value === "string" ? translate(value, undefined, DEFAULT_LOCALE) : value,
});

export const useLocale = (): LocaleContextType => useContext(LocaleContext);

export const useT = (): LocaleContextType["t"] => useLocale().t;

export const useTx = (): LocaleContextType["tx"] => useLocale().tx;

export const LocaleSnippet = `
  (function() {
    try {
      var l = localStorage.getItem("${LOCALE_STORAGE_KEY}");
      if (l !== "en" && l !== "ru") l = "${DEFAULT_LOCALE}";
      document.documentElement.lang = l;
    } catch (e) {
      document.documentElement.lang = "${DEFAULT_LOCALE}";
    }
  })();
`;

export const LocaleProvider: FC<PropsWithChildren> = ({ children }) => {
  // SSR and the first client render must share this value; stored locale is applied after hydration.
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);

  useLayoutEffect(() => {
    const stored = readStoredLocale();
    persistLocale(stored);
    setLocaleState(stored);
  }, []);

  const setLocale = useCallback((next: Locale) => {
    persistLocale(next);
    setLocaleState(next);
  }, []);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) =>
      translate(key, vars, locale),
    [locale],
  );

  const tx = useCallback(
    (value: ReactNode): ReactNode =>
      typeof value === "string" ? translate(value, undefined, locale) : value,
    [locale],
  );

  const value = useMemo(
    () => ({ locale, setLocale, t, tx }),
    [locale, setLocale, t, tx],
  );

  return (
    <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
  );
};
