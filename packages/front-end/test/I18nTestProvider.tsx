import { ReactNode } from "react";
import { setupI18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { messages } from "@/locales/en/messages.po";

const i18n = setupI18n({ locale: "en", messages: { en: messages } });

// Components that use <Trans> or useLingui() need this around them in tests.
export function I18nTestProvider({ children }: { children: ReactNode }) {
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}
