import { z } from "zod";
import {
  apiFeatureRuleV2Validator,
  apiFeatureRuleValidator,
  postFeatureRuleV2,
  postFeatureValidator,
} from "shared/validators";

// Write schemas are strict, so every key a GET response can carry must be
// accepted (even if ignored) by the matching write schema — otherwise the
// documented fetch → edit → send-back loop 400s. This is the drift guard: add a
// response-only field without accepting it on write and this fails, not a
// customer's round-trip.

type Variant = { type: string | null; keys: Set<string> };
type JsonSchema = Record<string, unknown>;

function variants(schema: JsonSchema): Variant[] {
  const branches = (schema.anyOf ?? schema.oneOf) as JsonSchema[] | undefined;
  if (branches) return branches.flatMap(variants);
  // allOf is an intersection: cross-product the parts' variants.
  let acc: Variant[] = [{ type: null, keys: new Set() }];
  for (const part of (schema.allOf as JsonSchema[] | undefined) ?? []) {
    const inner = variants(part);
    acc = acc.flatMap((a) =>
      inner.map((v) => ({
        type: a.type ?? v.type,
        keys: new Set([...a.keys, ...v.keys]),
      })),
    );
  }
  const props = (schema.properties ?? {}) as Record<string, JsonSchema>;
  const t = props.type;
  const own =
    t?.const !== undefined
      ? String(t.const)
      : Array.isArray(t?.enum) && t.enum.length === 1
        ? String(t.enum[0])
        : null;
  return acc.map((a) => ({
    type: a.type ?? own,
    keys: new Set([...a.keys, ...Object.keys(props)]),
  }));
}

// First `properties[name]` found while descending through allOf/anyOf.
function findProp(schema: JsonSchema, name: string): JsonSchema | undefined {
  const props = schema.properties as Record<string, JsonSchema> | undefined;
  if (props?.[name]) return props[name];
  for (const part of [
    ...((schema.allOf as JsonSchema[]) ?? []),
    ...((schema.anyOf as JsonSchema[]) ?? []),
  ]) {
    const hit = findProp(part, name);
    if (hit) return hit;
  }
  return undefined;
}

const json = (s: z.ZodType) =>
  z.toJSONSchema(s, { unrepresentable: "any" }) as JsonSchema;

function missingKeys(
  response: z.ZodType,
  input: JsonSchema,
  skipTypes: string[] = [],
) {
  const inputs = variants(input);
  const out: Record<string, string[]> = {};
  for (const r of variants(json(response))) {
    if (r.type !== null && skipTypes.includes(r.type)) continue;
    const candidates = inputs.filter(
      (i) => r.type === null || i.type === r.type,
    );
    if (candidates.length === 0) continue; // no write counterpart for this type
    const accepted = new Set(candidates.flatMap((c) => [...c.keys]));
    const missing = [...r.keys].filter((k) => !accepted.has(k)).sort();
    if (missing.length) out[r.type ?? "*"] = missing;
  }
  return out;
}

describe("write schemas accept every key their GET response emits", () => {
  it("v2 feature rules (bulk create/update)", () => {
    expect(
      missingKeys(apiFeatureRuleV2Validator, json(postFeatureRuleV2)),
    ).toEqual({});
  });

  it("v1 feature rules (bulk create/update)", () => {
    const env = findProp(json(postFeatureValidator.bodySchema), "environments")!
      .additionalProperties as JsonSchema;
    const rules = findProp(env, "rules")!.items as JsonSchema;
    expect(missingKeys(apiFeatureRuleValidator, rules)).toEqual({});
  });
});

// The write schemas are strict: a misspelled key must fail loudly instead of
// being stripped (which silently widened the rule's audience), while the
// read-only keys a GET emits are accepted and ignored.
describe("write schemas reject unknown keys but accept read-only echoes", () => {
  const echo = {
    pendingRamp: "create",
    rampScheduleId: "rs_1",
    scheduleType: "schedule",
  };

  it("v2 bulk rules", () => {
    const rule = { type: "force", value: "true", allEnvironments: true };
    expect(postFeatureRuleV2.safeParse({ ...rule, ...echo }).success).toBe(
      true,
    );
    for (const bad of [
      { conditions: "{}" },
      { savedGroup: [] },
      { savedGroups: [{ match: "all", ids: ["g"], extra: 1 }] },
      { prerequisites: [{ id: "f", condition: "{}", enabled: true }] },
      { scheduleRules: [{ timestamp: null, enabled: true, note: "x" }] },
    ]) {
      const res = postFeatureRuleV2.safeParse({ ...rule, ...bad });
      expect(res.success).toBe(false);
    }
    const expRef = {
      type: "experiment-ref",
      experimentId: "exp",
      allEnvironments: true,
      variations: [{ variationId: "v0", value: "1", weight: 0.5 }],
    };
    expect(postFeatureRuleV2.safeParse(expRef).success).toBe(false);
  });

  it("v1 bulk rules", () => {
    const body = postFeatureValidator.bodySchema;
    const feature = (rules: unknown[]) => ({
      id: "f",
      owner: "o",
      valueType: "boolean",
      defaultValue: "false",
      environments: { production: { enabled: true, rules } },
    });
    const rule = { type: "force", value: "true" };
    expect(
      body.safeParse(
        feature([
          { ...rule, rampScheduleId: "rs_1", scheduleType: "schedule" },
        ]),
      ).success,
    ).toBe(true);
    expect(
      body.safeParse(feature([{ ...rule, conditions: "{}" }])).success,
    ).toBe(false);
    expect(
      body.safeParse(
        feature([
          {
            ...rule,
            savedGroupTargeting: [
              { matchType: "all", savedGroups: ["g"], x: 1 },
            ],
          },
        ]),
      ).success,
    ).toBe(false);
  });
});
