import * as validators from "../src/validators";

/**
 * Generic revision landing verbs accept consistent remediation fields.
 * Saved Groups omit schema and hook overrides.
 */

const REMEDIATION_FIELDS = [
  "ignoreWarnings",
  "skipSchemaValidation",
  "skipHooks",
] as const;

type EndpointValidator = {
  path: string;
  operationId: string;
  bodySchema?: { shape?: Record<string, unknown> };
};

function isEndpointValidator(v: unknown): v is EndpointValidator {
  const o = v as Record<string, unknown> | null;
  return (
    !!o &&
    typeof o === "object" &&
    typeof o.path === "string" &&
    typeof o.operationId === "string"
  );
}

const GENERIC_ENTITIES = {
  config: "/configs-revisions/",
  constant: "/constants-revisions/",
  "saved-group": "/saved-groups-revisions/",
} as const;

const GENERIC_ENTITY_NAMES = Object.keys(
  GENERIC_ENTITIES,
) as (keyof typeof GENERIC_ENTITIES)[];

// Inspect schema shape because probe bodies may fail unrelated required fields.
function accepts(v: EndpointValidator, field: string): boolean {
  return !!v.bodySchema?.shape && field in v.bodySchema.shape;
}

const byVerb = new Map<string, Map<string, string[]>>();
for (const v of Object.values(validators).filter(isEndpointValidator)) {
  const entity = Object.entries(GENERIC_ENTITIES).find(([, prefix]) =>
    v.path.startsWith(prefix),
  )?.[0];
  if (!entity) continue;
  const verb = v.path.split("/").pop() ?? "";
  if (
    ![
      "publish",
      "revert",
      "archive",
      "request-review",
      "schedule-publish",
    ].includes(verb)
  ) {
    continue;
  }
  const fields = REMEDIATION_FIELDS.filter((f) => accepts(v, f));
  if (!byVerb.has(verb)) byVerb.set(verb, new Map());
  byVerb.get(verb)!.set(entity, fields.slice().sort());
}

describe("generic revision entities accept the same remediation fields per verb", () => {
  it("found all five verbs across all three entities", () => {
    // Prevent parity checks from passing vacuously.
    expect(
      Object.fromEntries(
        [...byVerb].map(([verb, m]) => [verb, [...m.keys()].sort()]),
      ),
    ).toEqual({
      publish: ["config", "constant", "saved-group"],
      revert: ["config", "constant", "saved-group"],
      archive: ["config", "constant", "saved-group"],
      "request-review": ["config", "constant", "saved-group"],
      "schedule-publish": ["config", "constant", "saved-group"],
    });
  });

  it("every entity accepts ignoreWarnings on every landing verb", () => {
    const missing: string[] = [];
    for (const [verb, perEntity] of byVerb) {
      for (const [entity, fields] of perEntity) {
        if (!fields.includes("ignoreWarnings"))
          missing.push(`${entity}:${verb}`);
      }
    }
    expect(missing.sort()).toEqual([]);
  });

  it.each([...GENERIC_ENTITY_NAMES])(
    "%s spells the remediation set the same way on all of its verbs",
    (entity) => {
      const perVerb = Object.fromEntries(
        [...byVerb].map(([verb, m]) => [verb, m.get(entity)!]),
      );
      const [reference] = Object.values(perVerb);
      expect(perVerb).toEqual(
        Object.fromEntries(Object.keys(perVerb).map((v) => [v, reference])),
      );
    },
  );
});
