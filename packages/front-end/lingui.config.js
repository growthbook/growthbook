import { defineConfig } from "@lingui/cli";
import { formatter } from "@lingui/format-po";

export default defineConfig({
  sourceLocale: "en",
  locales: [
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
  ],
  fallbackLocales: {
    default: "en",
  },
  // File paths tell translators where a string is used; line numbers would
  // rewrite every catalog on unrelated edits.
  format: formatter({ lineNumbers: false }),
  catalogs: [
    {
      path: "<rootDir>/locales/{locale}/messages",
      include: [
        "components",
        "enterprise",
        "hooks",
        "pages",
        "services",
        "ui",
        "utils",
      ],
      exclude: ["**/*.test.*", "**/*.stories.*"],
    },
  ],
});
