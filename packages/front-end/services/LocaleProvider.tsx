import { Messages, setupI18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import {
  createContext,
  FC,
  PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { messages as enMessages } from "@/locales/en/messages.po";
import {
  defaultLanguage,
  LOCALE_STORAGE_KEY,
  resolveLanguage,
  SupportedLanguage,
} from "@/services/locale";

const catalogLoaders: Record<
  Exclude<SupportedLanguage, "en">,
  () => Promise<{ messages: Messages }>
> = {
  es: () => import("@/locales/es/messages.po"),
  de: () => import("@/locales/de/messages.po"),
  it: () => import("@/locales/it/messages.po"),
  ja: () => import("@/locales/ja/messages.po"),
  zh: () => import("@/locales/zh/messages.po"),
  fr: () => import("@/locales/fr/messages.po"),
  pl: () => import("@/locales/pl/messages.po"),
  pt: () => import("@/locales/pt/messages.po"),
  ru: () => import("@/locales/ru/messages.po"),
  hi: () => import("@/locales/hi/messages.po"),
  tr: () => import("@/locales/tr/messages.po"),
  ko: () => import("@/locales/ko/messages.po"),
};

async function loadCatalog(language: SupportedLanguage): Promise<Messages> {
  if (language === "en") return enMessages;
  const { messages } = await catalogLoaders[language]();
  return messages;
}

type LocaleContextType = {
  language: SupportedLanguage;
  setLanguage: (language: SupportedLanguage) => void;
};

const LocaleContext = createContext<LocaleContextType>({
  language: defaultLanguage,
  setLanguage: () => undefined,
});

export const useLocale = (): LocaleContextType => useContext(LocaleContext);

export const LocaleProvider: FC<PropsWithChildren> = ({ children }) => {
  const [language, setLanguageState] =
    useState<SupportedLanguage>(defaultLanguage);
  // The UI stays in the current language until the next catalog has loaded.
  const [catalog, setCatalog] = useState<{
    language: SupportedLanguage;
    messages: Messages;
  }>({ language: defaultLanguage, messages: enMessages });

  // Read after mount: the server renders English, and the first client render
  // has to match it.
  useEffect(() => {
    try {
      setLanguageState(
        resolveLanguage(localStorage.getItem(LOCALE_STORAGE_KEY)),
      );
    } catch (e) {
      // The browser's privacy settings block storage, so stay in English
    }
  }, []);

  useEffect(() => {
    if (language === catalog.language) return;
    let cancelled = false;
    loadCatalog(language)
      .then((messages) => {
        if (!cancelled) setCatalog({ language, messages });
      })
      .catch(() => {
        // The catalog chunk failed to load; keep the current language
      });
    return () => {
      cancelled = true;
    };
  }, [language, catalog.language]);

  useEffect(() => {
    document.documentElement.lang = catalog.language;
  }, [catalog.language]);

  const i18n = useMemo(() => {
    const runtime = setupI18n();
    runtime.load(catalog.language, catalog.messages);
    runtime.activate(catalog.language);
    return runtime;
  }, [catalog]);

  const setLanguage = useCallback((updated: SupportedLanguage) => {
    setLanguageState(updated);
    try {
      if (updated === defaultLanguage) {
        localStorage.removeItem(LOCALE_STORAGE_KEY);
      } else {
        localStorage.setItem(LOCALE_STORAGE_KEY, updated);
      }
    } catch (e) {
      // The browser's privacy settings block storage, so the choice lasts
      // until the page reloads
    }
  }, []);

  const value = useMemo(
    () => ({ language, setLanguage }),
    [language, setLanguage],
  );

  return (
    <LocaleContext.Provider value={value}>
      <I18nProvider i18n={i18n}>{children}</I18nProvider>
    </LocaleContext.Provider>
  );
};
