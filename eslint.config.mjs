import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, globalIgnores } from "eslint/config";
import { fixupConfigRules, fixupPluginRules } from "@eslint/compat";
import react from "eslint-plugin-react";
import typescriptEslint from "@typescript-eslint/eslint-plugin";
import prettier from "eslint-plugin-prettier";
import nextEslintPluginNext from "@next/eslint-plugin-next";
import noAsyncForeach from "eslint-plugin-no-async-foreach";
import globals from "globals";
import * as tsParser from "@typescript-eslint/parser";
import js from "@eslint/js";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
});

export default defineConfig([
  globalIgnores([
    "**/.next",
    "**/dist",
    "**/coverage",
    "docs/.docusaurus",
    "docs/docusaurus.config.js",
    "docs/build",
    "packages/sdk-js/scripts",
    "**/*.tsbuildinfo",
    "**/*.d.ts", // declaration files cause import plugin stack overflow
    // Shared barrel files re-export from dist/; import resolver fails when dist absent (e.g. CI before build)
    "packages/shared/*.js",
  ]),
  {
    extends: fixupConfigRules(
      compat.extends(
        "eslint:recommended",
        "plugin:import/recommended",
        "plugin:import/typescript",
        "plugin:react/recommended",
        "plugin:@typescript-eslint/eslint-recommended",
        "plugin:@typescript-eslint/recommended",
        "plugin:prettier/recommended",
        "plugin:@next/eslint-plugin-next/recommended",
        "plugin:react-hooks/recommended",
      ),
    ),

    plugins: {
      react: fixupPluginRules(react),
      "@typescript-eslint": fixupPluginRules(typescriptEslint),
      prettier: fixupPluginRules(prettier),
      "@next/next": fixupPluginRules(nextEslintPluginNext),
      "no-async-foreach": noAsyncForeach,
    },

    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
        ...globals.es2015,
      },

      parser: tsParser,
      ecmaVersion: 2018,
      sourceType: "module",

      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },

    settings: {
      react: {
        version: "detect",
      },

      "import/parsers": {
        "@typescript-eslint/parser": [".ts", ".tsx"],
      },

      "import/resolver": {
        node: true,

        typescript: {
          alwaysTryTypes: true,
          project: ["packages/*/tsconfig.json"],
        },
      },
    },

    rules: {
      // Use TypeScript-ESLint version instead of base rule
      "no-unused-expressions": "off",
      "@typescript-eslint/no-unused-expressions": [
        "error",
        {
          allowShortCircuit: true,
          enforceForJSX: true,
          allowTernary: true,
        },
      ],

      "no-async-foreach/no-async-foreach": 2,
      "@next/next/no-html-link-for-pages": [
        "warn",
        "./packages/front-end/pages",
      ],
      "@next/next/no-img-element": "off",
      "@typescript-eslint/explicit-module-boundary-types": "off",
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/no-explicit-any": 1,

      "@typescript-eslint/no-inferrable-types": [
        "warn",
        {
          ignoreParameters: true,
        },
      ],

      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrors: "none",
        },
      ],

      "no-console": ["warn"],
      "no-restricted-imports": "off",
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",

      "react/no-unknown-property": [
        "error",
        {
          ignore: ["jsx", "global"],
        },
      ],

      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",

      "import/order": [
        "error",
        {
          groups: [
            "builtin",
            "external",
            "internal",
            "parent",
            "sibling",
            "index",
            "unknown",
          ],
        },
      ],
      // These rules are noisy and commonly flag valid patterns
      "import/no-named-as-default": "off",
      "import/no-named-as-default-member": "off",

      "@typescript-eslint/prefer-ts-expect-error": "error",
    },
  },
  {
    files: [
      "./packages/sdk-js/rollup.config.js",
      "./packages/sdk-react/rollup.config.js",
    ],

    rules: {
      "import/no-named-as-default": "off",
    },
  },
  {
    files: ["./packages/front-end/**/*.ts*"],
    ignores: ["./packages/front-end/ui/**/*.ts*"],

    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@radix-ui/themes",
              message:
                "Don't import Radix directly. Use our design system wrappers from @/ui/ instead.",

              importNames: [
                "Avatar",
                "Badge",
                "Button",
                "Callout",
                "Checkbox",
                "DataList",
                "DropdownMenu",
                "Heading",
                "Link",
                "RadioCards",
                "RadioGroup",
                "Select",
                "Switch",
                "Table",
                "Tabs",
                "Text",
              ],
            },
          ],

          patterns: [
            {
              group: ["..*"],
            },
            {
              group: ["*back-end*", "**/sdk-{js,react}*"],
              message: "front-end can only import from shared or itself.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["./packages/front-end/**/*.ts*"],

    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "MemberExpression[object.object.name='window'][object.property.name='history'][property.name='pushState']",
          message:
            "Don't use window.history.pushState directly. Use router.push(url, undefined, { shallow: true }) from next/router instead.",
        },
        {
          selector:
            "MemberExpression[object.object.name='window'][object.property.name='history'][property.name='replaceState']",
          message:
            "Don't use window.history.replaceState directly. Use router.replace(url, undefined, { shallow: true }) from next/router instead.",
        },
      ],
    },
  },
  {
    files: [
      "./packages/docs/pages/_app.tsx",
      "./packages/front-end/components/Auth/InAppHelp.tsx",
      "./packages/front-end/components/Dimensions/DimensionChooser.tsx",
      "./packages/front-end/components/Experiment/ImportExperimentModal.tsx",
      "./packages/front-end/components/Experiment/NewExperimentForm.tsx",
      "./packages/front-end/components/Experiment/VisualEditorScriptMissing.tsx",
      "./packages/front-end/components/Features/CodeSnippetModal.tsx",
      "./packages/front-end/components/Features/DraftModal.tsx",
      "./packages/front-end/components/Features/RuleList.tsx",
      "./packages/front-end/components/Forms/SelectField.tsx",
      "./packages/front-end/components/HomePage/NorthStar.tsx",
      "./packages/front-end/components/Markdown/MarkdownInput.tsx",
      "./packages/front-end/components/Metrics/MetricForm.tsx",
      "./packages/front-end/components/ProtectedPage.tsx",
      "./packages/front-end/components/Queries/RunQueriesButton.tsx",
      "./packages/front-end/components/Segments/PickSegmentModal.tsx",
      "./packages/front-end/components/Settings/UpgradeModal.tsx",
      "./packages/front-end/components/Share/ShareModal.tsx",
      "./packages/front-end/components/Tabs/ControlledTabs.tsx",
      "./packages/front-end/components/TempMessage.tsx",
      "./packages/front-end/pages/experiments/index.tsx",
      "./packages/front-end/pages/idea/\\[iid\\].tsx",
      "./packages/front-end/pages/index.tsx",
      "./packages/front-end/pages/integrations/vercel/index.tsx",
      "./packages/front-end/pages/invitation.tsx",
      "./packages/front-end/pages/metric/\\[mid\\].tsx",
      "./packages/front-end/pages/oauth/callback.tsx",
      "./packages/front-end/pages/report/\\[rid\\].tsx",
      "./packages/front-end/pages/reports.tsx",
      "./packages/front-end/pages/settings/index.tsx",
      "./packages/front-end/pages/settings/team.tsx",
      "./packages/front-end/services/DefinitionsContext.tsx",
      "./packages/front-end/services/features.ts",
      "./packages/front-end/services/search.tsx",
      "./packages/front-end/services/useGlobalMenu.ts",
      "./packages/front-end/services/useSwitchOrg.ts",
    ],

    rules: {
      "react-hooks/exhaustive-deps": "off",
    },
  },
  {
    files: [
      "./packages/sdk-js/**/*",
      "./packages/front-end/**/*",
      "./packages/back-end/test/**/*",
      "./packages/back-end/src/scripts/**/*",
      "./packages/back-end/**/*.test.{ts,tsx,js,jsx}",
    ],

    rules: {
      "no-console": "off",
    },
  },
  {
    files: ["./packages/back-end/**/*"],

    ignores: [
      "./packages/back-end/src/util/http.util.ts",
      "./packages/back-end/**/*.test.{ts,tsx,js,jsx}",
    ],

    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "node-fetch",
              message:
                'Use `import { fetch } from "back-end/src/util/http.util";` instead.',
              importNames: ["default"],
            },
          ],

          patterns: [
            {
              group: ["..*"],
            },
            {
              group: ["*front-end*", "**/sdk-{js,react}*"],
              message: "back-end can only import from shared or itself.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["./packages/shared/**/*"],

    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["*back-end*", "*front-end*"],
              message: "shared cannot import from back-end or front-end.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["./packages/sdk-{js,react}/**/*"],

    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["*back-end*", "*front-end*", "**/shared*"],
              message: "SDK packages cannot import from internal packages.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["./packages/shared/src/validators/*"],

    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.property.name='default']",
          message:
            "Using .default() on Zod schemas is disallowed. Use the defaultValues option in the BaseModel config instead.",
        },
      ],
    },
  },
  {
    // CommonJS files that need require()
    files: [
      "./packages/shared/*.js",
      "./packages/front-end/next.config.js",
      "./packages/sdk-js/plugins/index.js",
      "./packages/sdk-js/test/*.test.ts",
      "./packages/sdk-js/.babelrc.js",
    ],

    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
]);
