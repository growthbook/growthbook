import fs from "fs";
import path from "path";
import { RuleTester } from "eslint";
import * as tsParser from "@typescript-eslint/parser";
// eslint-disable-next-line no-restricted-imports -- repo-root eslint-rules/ is outside every package alias
import rule from "../../../../eslint-rules/no-rest-api-path.mjs";

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

const error = { messageId: "noRestApiPath" };

ruleTester.run("no-rest-api-path", rule, {
  valid: [
    { code: 'useApi("/api/init");' },
    { code: 'useApi("/features");' },
    { code: 'const vendor = "/api/vendor";' },
    { code: "fetch(`${host}/api/v1/features`);" },
    { code: "const re = /^\\/api\\/v1\\//;" },
  ],
  invalid: [
    {
      code: 'useApi("/api/v1/features");',
      errors: [error],
    },
    {
      code: 'apiCall(`/api/v1/features/${id}`, { method: "POST" });',
      errors: [error],
    },
    {
      code: 'const path = "/api/v1/features"; useApi(path);',
      errors: [{ ...error, line: 1, column: 14 }],
    },
    {
      code: "const updateEndpoint = `/api/v1/contextual-bandits/${id}`;",
      errors: [error],
    },
    {
      code: "<Foo cancelEndpoint={`/api/v1/x/${id}/cancel`} />;",
      errors: [error],
    },
    {
      code: '<Foo endpoint="/api/v1/x" />;',
      errors: [error],
    },
    {
      code: 'useApi("/api/v2/features");',
      errors: [error],
    },
  ],
});

it("points at a guide that exists", () => {
  const guide = rule.meta?.messages?.noRestApiPath.match(
    /\.agents\/guides\/\S+\.md/,
  )?.[0];
  if (!guide) throw new Error("message names no .agents/guides path");
  expect(fs.existsSync(path.resolve(__dirname, "../../../..", guide))).toBe(
    true,
  );
});
