import * as validators from "../src/validators";

/**
 * Every landing verb on Config, Constant and Saved Group revisions must accept the
 * acknowledgment its own guards ask for, and each entity must spell it the same way
 * across all of its verbs.
 *
 * Guards are declared adapter-side and bodies validator-side, with nothing tying
 * the two together — so an endpoint could raise a 422 saying `re-send with
 * "ignoreWarnings": true` while its own strict body rejected exactly that, making it
 * permanently unusable for the case the guard exists to warn about. That shipped on
 * six endpoints across all four entities, every one of them a divergence from the
 * Config spelling of the same endpoint.
 *
 * Two separate rules, because the entities are NOT identical:
 *
 *  - `ignoreWarnings` is universal — every one of these verbs can raise a
 *    reference/dependents warning on every entity.
 *  - `skipSchemaValidation` / `skipHooks` are present iff the entity HAS a schema and
 *    hooks. Saved Groups have neither, so advertising them there would document
 *    overrides that can never do anything. What must not vary is the spelling within
 *    one entity: whatever it takes on `publish` it takes on `revert` too.
 *
 * Feature Flags are excluded: they run a separate revision system with no arm-time
 * fingerprint capture, so several of their bodies legitimately accept nothing here.
 *
 * Walks the exported validators, so a new verb is covered the day all three declare
 * it — and a verb only ONE of them declares shows up as a coverage gap.
 */

const REMEDIATION_FIELDS = [
  "ignoreWarnings",
  "skipSchemaValidation",
  "skipHooks",
] as const;

type EndpointValidator = {
  path: string;
  operationId: string;
  // Zod object schemas expose their keys on `.shape`.
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

/**
 * Does this body DECLARE the field?
 *
 * Read off the schema's shape rather than by parsing a probe body: several of these
 * bodies have required fields (`archived`, `scheduledPublishAt`), so a probe of
 * `{ ignoreWarnings: true }` fails for a reason that has nothing to do with the flag
 * — which reported every one of them as accepting nothing.
 */
function accepts(v: EndpointValidator, field: string): boolean {
  return !!v.bodySchema?.shape && field in v.bodySchema.shape;
}

// verb -> entity -> accepted fields
const byVerb = new Map<string, Map<string, string[]>>();
for (const v of Object.values(validators).filter(isEndpointValidator)) {
  const entity = Object.entries(GENERIC_ENTITIES).find(([, prefix]) =>
    v.path.startsWith(prefix),
  )?.[0];
  if (!entity) continue;
  const verb = v.path.split("/").pop() ?? "";
  // Field-edit endpoints (`/value`, `/metadata`, …) land nothing and raise no
  // publish guard; the verbs below are the ones that land or arm a landing.
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
    // Without this the parity assertions below pass vacuously the moment a path
    // shape changes or an entity stops declaring a verb.
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
