import { z } from "zod";
import {
  apiFeatureRuleV2Validator,
  apiFeatureRuleValidator,
  featureRule,
  postFeatureRuleV2,
  postFeatureValidator,
} from "shared/validators";

// Write schemas are strict, so every key a GET response can carry must be
// accepted (even if ignored) by the matching write schema, or the documented
// fetch → edit → send-back loop 400s.

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

// The v1 read model spreads the stored rule (minus v2 scope) into the
// response, so the stored schema's keys must be accepted by the v1 write schema.
describe("v1 write schema accepts every stored rule key the read model emits", () => {
  it("per rule type", () => {
    const env = findProp(json(postFeatureValidator.bodySchema), "environments")!
      .additionalProperties as JsonSchema;
    const rules = findProp(env, "rules")!.items as JsonSchema;
    const inputs = variants(rules);
    const emittedOnly = ["savedGroupTargeting"];
    const notEmitted = new Set(["allEnvironments", "environments"]);
    const out: Record<string, string[]> = {};
    for (const stored of variants(json(featureRule))) {
      const accepted = new Set(
        inputs
          .filter((i) => i.type === stored.type)
          .flatMap((i) => [...i.keys]),
      );
      if (accepted.size === 0) continue;
      const missing = [...stored.keys, ...emittedOnly]
        .filter((k) => !notEmitted.has(k) && !accepted.has(k))
        .sort();
      if (missing.length) out[stored.type ?? "*"] = missing;
    }
    expect(out).toEqual({});
  });

  it("legacy inline experiment rules echo stored keys but reject typos", () => {
    const rule = {
      type: "experiment",
      condition: "{}",
      values: [{ value: "true", weight: 1 }],
    };
    const body = (r: object) =>
      postFeatureValidator.bodySchema.safeParse({
        id: "f",
        owner: "o",
        valueType: "boolean",
        defaultValue: "false",
        environments: { production: { enabled: true, rules: [r] } },
      }).success;
    expect(body({ ...rule, hashVersion: 2, experimentType: "standard" })).toBe(
      true,
    );
    expect(body({ ...rule, savedGroup: [] })).toBe(false);
  });
});
