import assert from "node:assert/strict";
import { test } from "node:test";
import {
  analyze,
  extractSkillReferences,
  hasBlockingDrift,
  parseSpecOperations,
} from "./check-agent-skills-drift.mjs";

const spec = (paths) =>
  ["openapi: 3.1.0", "paths:", ...paths, "components:", "  schemas: {}"].join(
    "\n",
  );

const HEAD = spec([
  "  /v1/experiments/{id}:",
  "    get:",
  "      operationId: getExperiment",
  "    post:",
  "      operationId: updateExperiment",
  "  /v2/features/{id}/revisions/{version}/rules:",
  "    post:",
  "      operationId: addRule",
  "      summary: changed",
  "  /v1/features:",
  "    get:",
  "      deprecated: true",
]);

const BASE = spec([
  "  /v1/experiments/{id}:",
  "    get:",
  "      operationId: getExperiment",
  "    post:",
  "      operationId: updateExperiment",
  "    delete:",
  "      operationId: deleteExperiment",
  "  /v2/features/{id}/revisions/{version}/rules:",
  "    post:",
  "      operationId: addRule",
  "  /v1/features:",
  "    get:",
  "      deprecated: true",
]);

const SKILL = [
  "gb-call POST '/api/v2/features/<flag-id>/revisions/new/rules' -",
  "Call `GET /api/v1/experiments/exp_123`.",
  "Drafts: `DELETE /api/v1/experiments/<id>`.",
  "Legacy: GET /api/v1/features?limit=10",
  "Missing: GET /api/v2/flag-revisions.",
  "Prose shorthand like POST /start is ignored.",
].join("\n");

test("parses operations and deprecation", () => {
  const ops = parseSpecOperations(HEAD);
  assert.deepEqual(
    [...ops.keys()],
    [
      "GET /v1/experiments/{id}",
      "POST /v1/experiments/{id}",
      "POST /v2/features/{id}/revisions/{version}/rules",
      "GET /v1/features",
    ],
  );
  assert.equal(ops.get("GET /v1/features").deprecated, true);
});

test("extracts only absolute /api references", () => {
  const refs = extractSkillReferences(SKILL);
  assert.deepEqual(
    refs.map((r) => `${r.method} ${r.path}`),
    [
      "POST /v2/features/<flag-id>/revisions/new/rules",
      "GET /v1/experiments/exp_123",
      "DELETE /v1/experiments/<id>",
      "GET /v1/features",
      "GET /v2/flag-revisions",
    ],
  );
});

test("reports missing, deprecated and impacted operations", () => {
  const result = analyze({
    skillFiles: [{ file: "skills/x.md", text: SKILL }],
    operations: parseSpecOperations(HEAD),
    baseOperations: parseSpecOperations(BASE),
  });
  assert.deepEqual(
    result.missing.map((m) => m.label),
    ["DELETE /api/v1/experiments/<id>", "GET /api/v2/flag-revisions"],
  );
  assert.deepEqual(
    result.deprecated.map((d) => d.label),
    ["GET /api/v1/features"],
  );
  assert.deepEqual(
    Object.fromEntries(
      [...result.impacted].map(([key, { kind }]) => [key, kind]),
    ),
    {
      "POST /v2/features/{id}/revisions/{version}/rules": "changed",
      "DELETE /v1/experiments/{id}": "removed",
    },
  );
  assert.equal(hasBlockingDrift(result, true), true);
});

test("pre-existing missing references do not block a PR", () => {
  const result = analyze({
    skillFiles: [{ file: "skills/x.md", text: "GET /api/v2/flag-revisions" }],
    operations: parseSpecOperations(HEAD),
    baseOperations: parseSpecOperations(HEAD),
  });
  assert.equal(result.missing.length, 1);
  assert.equal(hasBlockingDrift(result, true), false);
  assert.equal(hasBlockingDrift(result, false), true);
});
