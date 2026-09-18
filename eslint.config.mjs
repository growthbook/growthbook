import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, globalIgnores } from "eslint/config";
import { fixupConfigRules, fixupPluginRules } from "@eslint/compat";
import react from "eslint-plugin-react";
import typescriptEslint from "@typescript-eslint/eslint-plugin";
import nextEslintPluginNext from "@next/eslint-plugin-next";
import noAsyncForeach from "eslint-plugin-no-async-foreach";
import globals from "globals";
import * as tsParser from "@typescript-eslint/parser";
import js from "@eslint/js";
import { FlatCompat } from "@eslint/eslintrc";
import noAlertClassname from "./eslint-rules/no-alert-classname.mjs";
import restrictedQueryTypes from "./eslint-rules/restricted-query-types.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
});
// Strip invalid "name" property from Next.js flat config (ESLint 9 rejects it)
const { name: _nextName, ...nextRecommendedConfig } =
  nextEslintPluginNext.configs.recommended;

export default defineConfig([
  globalIgnores([
    // Claude Code parks agent worktrees (full checkouts) here; linting them
    // rewrites another branch's files.
    ".claude/",
    "**/.next",
    "**/dist",
    "**/coverage",
    "**/.venv",
    "**/node_modules",
    "docs/.docusaurus",
    "docs/docusaurus.config.js",
    "docs/build",
    "docs-archive/",
    "packages/sdk-js/scripts",
    "**/*.tsbuildinfo",
    "packages/shared/types/*.js",
  ]),
  nextRecommendedConfig,
  {
    extends: fixupConfigRules(
      compat.extends(
        "eslint:recommended",
        "plugin:import/recommended",
        "plugin:import/typescript",
        "plugin:react/recommended",
        "plugin:@typescript-eslint/eslint-recommended",
        "plugin:@typescript-eslint/recommended",
        "plugin:react-hooks/recommended",
      ),
    ),

    plugins: {
      react: fixupPluginRules(react),
      "@typescript-eslint": fixupPluginRules(typescriptEslint),
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
          project: [
            "packages/*/tsconfig.json",
            "packages/back-end/test/tsconfig.json",
          ],
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

      "react/jsx-key": [
        "error",
        {
          checkFragmentShorthand: true,
          checkKeyMustBeforeSpread: true,
          warnOnDuplicates: true,
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
    // Standalone runtime/tooling scripts (no build step): require() is correct
    // and console is the intended logging channel.
    files: ["./preview/idle-monitor.js", "./scripts/*.js", "./scripts/*.mjs"],

    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "no-console": "off",
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
                "Dialog",
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
            {
              name: "@/components/Modal",
              message:
                "Use the new Modal from @/ui/Modal instead of the legacy Modal component.",
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
            {
              group: ["shared/src", "shared/src/*", "shared/src/**"],
              message:
                "Import from the package (e.g., 'shared/validators') instead of 'shared/src/...'",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["./packages/front-end/**/*.ts*"],

    plugins: {
      local: {
        rules: {
          "no-alert-classname": noAlertClassname,
        },
      },
    },

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
        {
          selector:
            "JSXAttribute[name.name='size'][value.type='Literal'][value.value='legacy']",
          message:
            'Do not add new `size="legacy"` props. Omit `size` to use the component default, or use an explicit design-system size ("x-small", "small", or "medium" on Select/SelectField/MultiSelectField/StringArrayField/TextField; "sm" or "md" on Field).',
        },
        {
          selector:
            "JSXAttribute[name.name='size'] JSXExpressionContainer > Literal[value='legacy']",
          message:
            'Do not add new `size="legacy"` props. Omit `size` to use the component default, or use an explicit design-system size ("x-small", "small", or "medium" on Select/SelectField/MultiSelectField/StringArrayField/TextField; "sm" or "md" on Field).',
        },
      ],
      "local/no-alert-classname": "error",
    },
  },
  {
    files: ["./packages/front-end/**/*.stories.tsx"],

    rules: {
      // Design system stories intentionally demonstrate all size variants, including legacy.
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
            {
              group: ["shared/src", "shared/src/*", "shared/src/**"],
              message:
                "Import from the package (e.g., 'shared/validators') instead of 'shared/src/...'",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["./packages/back-end/**/*.ts"],
    ignores: ["./packages/back-end/**/*.test.{ts,tsx,js,jsx}"],
    plugins: {
      localBackend: {
        rules: { "restricted-query-types": restrictedQueryTypes },
      },
    },
    rules: {
      "localBackend/restricted-query-types": "error",
    },
  },
  {
    files: [
      "./packages/back-end/src/controllers/**/*.ts",
      "./packages/back-end/src/routers/**/*.controller.ts",
      "./packages/back-end/src/enterprise/routers/**/*.controller.ts",
    ],

    rules: {
      "import/no-restricted-paths": [
        "error",
        {
          zones: [
            {
              target: "./packages/back-end/src/controllers/**/*.ts",
              from: "./packages/back-end/src/controllers",
              message:
                "Controllers must not import other controllers. Move shared logic into services/, models/, or util/.",
            },
            {
              target: "./packages/back-end/src/controllers/**/*.ts",
              from: [
                "./packages/back-end/src/routers/**/*.controller.ts",
                "./packages/back-end/src/enterprise/routers/**/*.controller.ts",
              ],
              message:
                "Controllers must not import other controllers. Move shared logic into services/, models/, or util/.",
            },
            {
              target: [
                "./packages/back-end/src/routers/**/*.controller.ts",
                "./packages/back-end/src/enterprise/routers/**/*.controller.ts",
              ],
              from: "./packages/back-end/src/controllers",
              message:
                "Controllers must not import other controllers. Move shared logic into services/, models/, or util/.",
            },
            {
              target: [
                "./packages/back-end/src/routers/**/*.controller.ts",
                "./packages/back-end/src/enterprise/routers/**/*.controller.ts",
              ],
              from: [
                "./packages/back-end/src/routers/**/*.controller.ts",
                "./packages/back-end/src/enterprise/routers/**/*.controller.ts",
              ],
              message:
                "Controllers must not import other controllers. Move shared logic into services/, models/, or util/.",
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
            {
              group: ["shared/src", "shared/src/*", "shared/src/**"],
              message:
                "Within shared, use relative paths or import from shared without /src/",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["./packages/stats-ts/**/*"],

    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["*back-end*", "*front-end*"],
              message: "stats-ts cannot import from back-end or front-end.",
            },
            {
              group: ["shared/src", "shared/src/*", "shared/src/**"],
              message:
                "Import from the package (e.g., 'shared/experiments') instead of 'shared/src/...'",
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
        {
          selector:
            "Property[key.name='owner'] CallExpression[callee.type='MemberExpression'][callee.object.name='z'][callee.property.name='string']",
          message:
            "Use ownerField or ownerInputField from 'shared/validators' instead of a bare z.string() for owner properties to ensure consistent API documentation.",
        },
      ],
    },
  },
  {
    // tsc already resolves imports and enumerates exports, making these rules
    // redundant. The ExportMap rules (import/default, import/namespace,
    // import/export) also parse every imported module, so disabling all four
    // shaves ~45s off an uncached full lint. docs/ and plain .js keep them since
    // tsc never sees those. Scripts under back-end/shared are outside their
    // tsconfig and lose import checking here, but they're dev-only.
    files: ["./packages/**/*.{ts,tsx}"],

    rules: {
      "import/default": "off",
      "import/export": "off",
      "import/namespace": "off",
      "import/no-unresolved": "off",
    },
  },
  {
    // Scope each package's resolver to its own tsconfig so import/order and
    // import/no-restricted-paths resolve against a smaller project.
    files: ["./packages/front-end/**/*.{ts,tsx}"],

    settings: {
      "import/resolver": {
        node: true,
        typescript: {
          alwaysTryTypes: true,
          project: ["packages/front-end/tsconfig.json"],
        },
      },
    },
  },
  {
    files: ["./packages/back-end/**/*.{ts,tsx}"],

    settings: {
      "import/resolver": {
        node: true,
        typescript: {
          alwaysTryTypes: true,
          project: [
            "packages/back-end/tsconfig.json",
            "packages/back-end/test/tsconfig.json",
          ],
        },
      },
    },
  },
  {
    files: ["./packages/shared/**/*.{ts,tsx}"],

    settings: {
      "import/resolver": {
        node: true,
        typescript: {
          alwaysTryTypes: true,
          project: ["packages/shared/tsconfig.json"],
        },
      },
    },
  },
  {
    // Type-aware linting, one entry per package's tsconfig'd source root.
    // projectService hard-errors on any file it can't map to a project, so this
    // list must track each tsconfig's `include`. Scripts under back-end/shared
    // are outside their tsconfig and would hard-error, so they're omitted.
    files: [
      "./packages/front-end/**/*.{ts,tsx}",
      "./packages/back-end/src/**/*.{ts,tsx}",
      "./packages/shared/src/**/*.{ts,tsx}",
      "./packages/sdk-js/src/**/*.{ts,tsx}",
      "./packages/sdk-react/src/**/*.{ts,tsx}",
      "./packages/stats-ts/src/**/*.{ts,tsx}",
    ],

    // Exclude test dirs everywhere: shared/test and back-end/test are outside
    // their tsconfig, and this keeps front-end/test consistent with them.
    ignores: ["./packages/*/test/**"],

    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: __dirname,
      },
    },

    rules: {
      "@typescript-eslint/switch-exhaustiveness-check": "error",
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
