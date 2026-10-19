import assert from "node:assert/strict";
import { test } from "node:test";
import {
  analyze,
  extractSkillReferences,
  hasBlockingDrift,
  parseSpec,
  stripDocText,
  toJson,
} from "./check-agent-skills-drift.mjs";

const spec = (paths, schemas = []) =>
  [
    "openapi: 3.1.0",
    "paths:",
    ...paths,
    "components:",
    "  schemas:",
    ...schemas,
  ].join("\n");

const REVISION = [
  "    Revision:",
  "      type: object",
  "      properties:",
  "        version:",
  "          type: integer",
];

const HEAD = spec(
  [
    "  /v1/experiments/{id}:",
    "    get:",
    "      operationId: getExperiment",
    "    post:",
    "      operationId: updateExperiment",
    "  /v2/features/{id}/revisions/{version}:",
    "    get:",
    "      operationId: getRevision",
    "      responses:",
    "        '200':",
    "          $ref: '#/components/schemas/Revision'",
    "  /v2/features/{id}/revisions/{version}/rules:",
    "    post:",
    "      operationId: addRule",
    "      description: Adds a rule.",
    "  /v1/features:",
    "    get:",
    "      deprecated: true",
  ],
  REVISION,
);

const BASE = spec(
  [
    "  /v1/experiments/{id}:",
    "    get:",
    "      operationId: getExperiment",
    "    post:",
    "      operationId: updateExperiment",
    "    delete:",
    "      operationId: deleteExperiment",
    "  /v2/features/{id}/revisions/latest:",
    "    get:",
    "      operationId: getLatestRevision",
    "  /v2/features/{id}/revisions/{version}:",
    "    get:",
    "      operationId: getRevision",
    "      responses:",
    "        '200':",
    "          $ref: '#/components/schemas/Revision'",
    "  /v2/features/{id}/revisions/{version}/rules:",
    "    post:",
    "      operationId: addRule",
    "      description: >",
    "        Adds a rule to",
    "        the draft.",
    "  /v1/features:",
    "    get:",
    "      operationId: listFeatures",
  ],
  REVISION.map((line) => line.replace("integer", "string")),
);

const SKILL = [
  "gb-call POST '/api/v2/features/<flag-id>/revisions/new/rules' -",
  "Call `GET /api/v1/experiments/exp_123`.",
  "Drafts: `DELETE /api/v1/experiments/<id>`.",
  "Latest: GET /api/v2/features/<id>/revisions/latest",
  "Inspect: GET /v2/features/<id>/revisions/3",
  "Legacy: GET /api/v1/features?limit=10",
  "Missing: GET /api/v2/flag-revisions.",
  "Prose shorthand like POST /start is ignored.",
].join("\n");

const skillFiles = [{ file: "skills/x.md", text: SKILL }];

test("parses operations, deprecation and components", () => {
  const { operations, components } = parseSpec(HEAD);
  assert.deepEqual(
    [...operations.keys()],
    [
      "GET /v1/experiments/{id}",
      "POST /v1/experiments/{id}",
      "GET /v2/features/{id}/revisions/{version}",
      "POST /v2/features/{id}/revisions/{version}/rules",
      "GET /v1/features",
    ],
  );
  assert.equal(operations.get("GET /v1/features").deprecated, true);
  assert.deepEqual([...components.keys()], ["schemas/Revision"]);
});

test("extracts /api and bare /vN references, not prose shorthand", () => {
  assert.deepEqual(
    extractSkillReferences(SKILL).map((r) => `${r.method} ${r.path}`),
    [
      "POST /v2/features/<flag-id>/revisions/new/rules",
      "GET /v1/experiments/exp_123",
      "DELETE /v1/experiments/<id>",
      "GET /v2/features/<id>/revisions/latest",
      "GET /v2/features/<id>/revisions/3",
      "GET /v1/features",
      "GET /v2/flag-revisions",
    ],
  );
});

test("strips doc text but keeps properties named description", () => {
  const body = [
    "      description: >",
    "        Long text",
    "      summary: Short",
    "      properties:",
    "        description:",
    "          type: string",
  ].join("\n");
  assert.equal(
    stripDocText(body),
    [
      "      properties:",
      "        description:",
      "          type: string",
    ].join("\n"),
  );
});

test("reports removed, re-routed, newly deprecated and component changes", () => {
  const result = analyze({
    skillFiles,
    spec: parseSpec(HEAD),
    baseSpec: parseSpec(BASE),
  });
  assert.deepEqual(
    result.missing.map((m) => `${m.method} ${m.path}`),
    ["DELETE /v1/experiments/<id>", "GET /v2/flag-revisions"],
  );
  assert.deepEqual(
    result.deprecated.map((m) => `${m.method} ${m.path}`),
    ["GET /v1/features"],
  );
  assert.deepEqual(
    Object.fromEntries(
      [...result.impacted].map(([key, { kind }]) => [key, kind]),
    ),
    {
      "DELETE /v1/experiments/{id}": "removed",
      "GET /v2/features/{id}/revisions/latest": "removed",
      "GET /v2/features/{id}/revisions/{version}": "changed",
      "GET /v1/features": "deprecated",
    },
  );
  assert.equal(hasBlockingDrift(result, { hasBase: true }), true);
});

test("description-only edits do not count as changes", () => {
  const result = analyze({
    skillFiles: [
      {
        file: "skills/x.md",
        text: "POST /api/v2/features/<id>/revisions/new/rules",
      },
    ],
    spec: parseSpec(HEAD),
    baseSpec: parseSpec(BASE),
  });
  assert.equal(result.impacted.size, 0);
});

test("pre-existing missing references do not block an API PR", () => {
  const result = analyze({
    skillFiles: [{ file: "skills/x.md", text: "GET /api/v2/flag-revisions" }],
    spec: parseSpec(HEAD),
    baseSpec: parseSpec(HEAD),
  });
  assert.equal(result.missing.length, 1);
  assert.equal(hasBlockingDrift(result, { hasBase: true }), false);
  assert.equal(hasBlockingDrift(result, { hasBase: false }), true);
});

test("baseline comparison flags new findings even when the count is unchanged", () => {
  const baseline = [
    { file: "skills/x.md", text: "GET /api/v2/flag-revisions" },
  ];
  const swapped = [
    { file: "skills/x.md", text: "POST /api/v2/features/<id>/toggle-all" },
  ];
  const result = analyze({
    skillFiles: swapped,
    spec: parseSpec(HEAD),
    baselineSkillFiles: baseline,
  });
  assert.equal(result.missing.length, 1);
  assert.deepEqual(
    result.introduced.map((f) => f.path),
    ["/v2/features/<id>/toggle-all"],
  );
  assert.equal(hasBlockingDrift(result, { hasBaseline: true }), true);

  const same = analyze({
    skillFiles: baseline,
    spec: parseSpec(HEAD),
    baselineSkillFiles: baseline,
  });
  assert.equal(hasBlockingDrift(same, { hasBaseline: true }), false);
  assert.deepEqual(toJson(same).introduced, []);
});

test("resolves in registration order and ignores parameter renames", () => {
  const ordered = (paths) => parseSpec(spec(paths));
  const latestFirst = ordered([
    "  /v2/features/{id}/revisions/latest:",
    "    get:",
    "      operationId: latest",
    "  /v2/features/{id}/revisions/{version}:",
    "    get:",
    "      operationId: byVersion",
  ]);
  const versionFirst = ordered([
    "  /v2/features/{id}/revisions/{version}:",
    "    get:",
    "      operationId: byVersion",
    "  /v2/features/{id}/revisions/latest:",
    "    get:",
    "      operationId: latest",
  ]);
  const skill = [
    { file: "skills/x.md", text: "GET /api/v2/features/<id>/revisions/latest" },
  ];
  const moved = analyze({
    skillFiles: skill,
    spec: versionFirst,
    baseSpec: latestFirst,
  });
  assert.equal(
    moved.impacted.get("GET /v2/features/{id}/revisions/latest").kind,
    "removed",
  );

  const renamed = analyze({
    skillFiles: [
      { file: "skills/x.md", text: "POST /api/v1/experiments/e_1/stop" },
    ],
    spec: ordered([
      "  /v1/experiments/{experimentId}/stop:",
      "    post:",
      "      x: 1",
    ]),
    baseSpec: ordered([
      "  /v1/experiments/{id}/stop:",
      "    post:",
      "      x: 1",
    ]),
  });
  assert.equal(renamed.impacted.size, 0);
});

test("parses component names with spaces and ignores doc-only list items", () => {
  const withRule = (extra) =>
    parseSpec(
      spec(
        [
          "  /v2/rules:",
          "    post:",
          "      requestBody:",
          "        oneOf:",
          ...extra,
        ],
        [
          "    Experiment:",
          "      type: object",
          "    Targeting Rule:",
          "      properties:",
          "        condition:",
          "          type: string",
        ],
      ),
    );
  const plain = withRule([
    "          - $ref: '#/components/schemas/Targeting Rule'",
  ]);
  const titled = withRule([
    "          - title: Targeting Rule",
    "            $ref: '#/components/schemas/Targeting Rule'",
  ]);
  assert.ok(plain.components.has("schemas/Targeting Rule"));
  const skillFiles = [{ file: "skills/x.md", text: "POST /api/v2/rules" }];
  assert.equal(
    analyze({ skillFiles, spec: titled, baseSpec: plain }).impacted.size,
    0,
  );
  const changed = parseSpec(
    spec(
      [
        "  /v2/rules:",
        "    post:",
        "      requestBody:",
        "        oneOf:",
        "          - $ref: '#/components/schemas/Targeting Rule'",
      ],
      [
        "    Experiment:",
        "      type: object",
        "    Targeting Rule:",
        "      properties:",
        "        condition:",
        "          type: object",
      ],
    ),
  );
  assert.equal(
    analyze({ skillFiles, spec: changed, baseSpec: plain }).impacted.get(
      "POST /v2/rules",
    ).kind,
    "changed",
  );
  assert.equal(
    analyze({
      skillFiles: [{ file: "x", text: "POST /api/v2/experiments" }],
      spec: changed,
      baseSpec: plain,
    }).impacted.size,
    0,
  );
});

test("only route-level deprecated: true deprecates, and negated mentions are not uses", () => {
  const fieldNote = parseSpec(
    spec([
      "  /v1/x:",
      "    post:",
      "      requestBody:",
      "        description: '**Deprecated.** old field'",
    ]),
  );
  assert.equal(fieldNote.operations.get("POST /v1/x").deprecated, false);
  const refs = extractSkillReferences(
    "Use `/stop`, not `POST /api/v1/experiments/<id>`. Call `POST /api/v1/experiments/<id>/stop`.",
  );
  assert.deepEqual(
    refs.map((r) => `${r.method} ${r.path}`),
    ["POST /v1/experiments/<id>/stop"],
  );
});

test("checks quoted paths without a method, skipping wildcards", () => {
  const result = analyze({
    skillFiles: [
      {
        file: "skills/x.md",
        text: "The `/api/v1/features` list and `/api/v2/feature-search` endpoint, or `/api/v1/product-analytics/*-exploration`.",
      },
    ],
    spec: parseSpec(HEAD),
  });
  assert.deepEqual(
    result.missing.map((m) => `${m.method} ${m.path}`),
    ["ANY /v2/feature-search"],
  );
});

test("baseline counts findings per endpoint, not per file or placeholder", () => {
  const baseline = [
    {
      file: "skills/a.md",
      text: "GET /api/v2/flag-revisions\nDELETE /api/v1/experiments/<id>",
    },
  ];
  const moved = [
    { file: "skills/b.md", text: "GET /api/v2/flag-revisions" },
    { file: "skills/a.md", text: "DELETE /api/v1/experiments/<experiment-id>" },
  ];
  const head = parseSpec(HEAD);
  assert.deepEqual(
    analyze({ skillFiles: moved, spec: head, baselineSkillFiles: baseline })
      .introduced,
    [],
  );
  const extra = [
    ...moved,
    { file: "skills/c.md", text: "GET /api/v2/flag-revisions?x=1" },
  ];
  assert.deepEqual(
    analyze({
      skillFiles: extra,
      spec: head,
      baselineSkillFiles: baseline,
    }).introduced.map((f) => f.file),
    ["skills/c.md"],
  );
});

test("lists new endpoints no skill uses", () => {
  const base = parseSpec(spec(["  /v1/a:", "    get:", "      x: 1"]));
  const head = parseSpec(
    spec([
      "  /v1/a:",
      "    get:",
      "      x: 1",
      "  /v1/b:",
      "    post:",
      "      x: 1",
      "  /v1/c/{id}:",
      "    get:",
      "      x: 1",
      "  /v1/old:",
      "    get:",
      "      deprecated: true",
    ]),
  );
  const result = analyze({
    skillFiles: [{ file: "skills/x.md", text: "GET /api/v1/c/c_1" }],
    spec: head,
    baseSpec: base,
  });
  assert.deepEqual(result.uncovered, ["POST /v1/b"]);
  assert.equal(hasBlockingDrift(result, { hasBase: true }), false);
  assert.deepEqual(toJson(result).uncovered, ["POST /v1/b"]);
});
