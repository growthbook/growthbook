import Ajv from "ajv";
import { SchemaField } from "shared/types/feature";
import { simpleToJSONSchema } from "../features";
import { CONSTANT_EXTENDS_KEY } from "../../constants";

export type ConfigValueValidationResult = {
  valid: boolean;
  errors: string[];
};

// A field value can be (or deeply contain) a reference token that resolves
// dynamically to whatever the target holds. We can't statically type-check those
// (a `"@const:timeout"` string may resolve to an integer), so such a value is
// exempt from type/extensibility checks here, mirroring how schema inference
// treats reference tokens as `any`.
//
// Only the forms the resolver actually substitutes count (see
// resolveConstants.ts): a bare `@const:key`/`@config:key` placeholder that IS
// the whole string (an `$extends` entry), or a `{{ @const:key }}` interpolation
// embedded in a string. A token that merely appears as free text (e.g.
// `"retry @config:base"`) is left verbatim by the resolver, so it must still be
// type-checked rather than exempted.
const REF_KEY = "[a-z0-9][a-z0-9_-]*";
const BARE_REF_RE = new RegExp(`^@(?:const|config):${REF_KEY}$`);
const INTERP_REF_RE = new RegExp(
  `\\{\\{\\s*@(?:const|config):${REF_KEY}\\s*\\}\\}`,
);

export function valueHasReferenceToken(v: unknown): boolean {
  if (typeof v === "string")
    return BARE_REF_RE.test(v) || INTERP_REF_RE.test(v);
  if (Array.isArray(v)) return v.some(valueHasReferenceToken);
  if (v !== null && typeof v === "object")
    return Object.values(v as Record<string, unknown>).some(
      valueHasReferenceToken,
    );
  return false;
}

// Return the top-level value keys that fail validation against the (effective)
// schema. Equivalent to calling `validateConfigValue` per key, but compiles the
// schema ONCE for the whole object and attributes errors back to top-level keys
// via Ajv's `instancePath` / `additionalProperty` — turning the per-node lineage
// scan from O(keys) Ajv compiles into O(1). Reference-backed keys are exempt
// (their resolved type is unknown), matching `validateConfigValue`. `required` is
// never enforced here (the incompatibility scan runs on sparse own values).
export function collectInvalidConfigValueKeys({
  value,
  fields,
  additionalProperties,
}: {
  value: Record<string, unknown>;
  fields: SchemaField[];
  additionalProperties: boolean;
}): string[] {
  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (k === CONSTANT_EXTENDS_KEY) continue;
    if (valueHasReferenceToken(v)) continue;
    data[k] = v;
  }
  const keys = Object.keys(data);
  if (!keys.length) return [];

  // No declared fields: the only constraint is extensibility — a non-extensible
  // config may carry no keys, so every present key is offending.
  if (!fields.length) return additionalProperties ? [] : keys;

  let schemaObj: Record<string, unknown>;
  try {
    schemaObj = JSON.parse(
      simpleToJSONSchema({ type: "object", fields, additionalProperties }),
    );
  } catch {
    // A malformed schema can't attribute a fault to a specific value key; the
    // schema itself is surfaced as invalid elsewhere.
    return [];
  }
  schemaObj.required = [];

  let validate: ReturnType<Ajv["compile"]>;
  try {
    validate = new Ajv({ strictSchema: false, allErrors: true }).compile(
      schemaObj,
    );
  } catch {
    return [];
  }
  if (validate(data)) return [];

  const offending = new Set<string>();
  for (const err of validate.errors ?? []) {
    const path = err.instancePath ?? "";
    if (path.startsWith("/")) {
      // Top-level key = first JSON-Pointer segment (un-escaped per RFC 6901).
      const seg = path.slice(1).split("/")[0];
      offending.add(seg.replace(/~1/g, "/").replace(/~0/g, "~"));
    } else {
      const addl = (err.params as { additionalProperty?: string })
        ?.additionalProperty;
      if (addl) offending.add(addl);
    }
  }
  // Preserve input order; drop any attribution that isn't a present key.
  return keys.filter((k) => offending.has(k));
}

// Validate a config's value object against its (effective) schema — the config
// analog of `validateJSONFeatureValue`. Configs differ from feature flags in two
// ways that this encodes:
//
//  - Values are SPARSE by design. A child config (or a base config mid-edit)
//    only stores the keys it sets; inherited/unset fields are filled by the
//    resolution chain. So `required` is only enforced when `requireAll` is set
//    (i.e. against a fully-resolved value, typically at publish), not on the
//    per-write sparse own value.
//  - `additionalProperties` comes from family extensibility, not the schema doc.
//
// The top-level `$extends` merge directive is stripped before validation (it's a
// composition instruction, not data).
// Recursively remove every `required` keyword from a JSON Schema document (the
// node itself and nested subschemas via properties/items/additionalProperties/
// combinators) — used for sparse-patch validation where completeness isn't
// enforced at any depth. Only descends into subschema positions, so a config
// field literally named "required" (a key inside a `properties` map) is left
// alone; only the JSON Schema keyword is stripped.
function stripRequiredDeep(schema: unknown): void {
  if (!schema || typeof schema !== "object") return;
  if (Array.isArray(schema)) {
    schema.forEach(stripRequiredDeep);
    return;
  }
  const s = schema as Record<string, unknown>;
  delete s.required;
  if (s.properties && typeof s.properties === "object") {
    for (const sub of Object.values(s.properties as Record<string, unknown>)) {
      stripRequiredDeep(sub);
    }
  }
  if (s.items) stripRequiredDeep(s.items);
  if (s.additionalProperties && typeof s.additionalProperties === "object") {
    stripRequiredDeep(s.additionalProperties);
  }
  for (const k of ["allOf", "anyOf", "oneOf"]) {
    if (Array.isArray(s[k])) (s[k] as unknown[]).forEach(stripRequiredDeep);
  }
}

export function validateConfigValue({
  value,
  fields,
  additionalProperties,
  requireAll = false,
}: {
  // Plain object (already JSON-parsed). Callers parse + shape-check upstream.
  value: Record<string, unknown>;
  // Effective schema fields (own + inherited). Empty = no schema to enforce.
  fields: SchemaField[];
  additionalProperties: boolean;
  // Enforce required fields (use for a resolved value, e.g. at publish).
  requireAll?: boolean;
}): ConfigValueValidationResult {
  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (k === CONSTANT_EXTENDS_KEY) continue;
    // Skip reference-backed fields — their resolved type/shape is unknown here.
    if (valueHasReferenceToken(v)) continue;
    data[k] = v;
  }

  // No declared fields: the only constraint is extensibility (a non-extensible
  // config with no schema may not carry any keys).
  if (!fields.length) {
    if (!additionalProperties && Object.keys(data).length > 0) {
      return {
        valid: false,
        errors: [
          `Unexpected field(s) ${Object.keys(data)
            .map((k) => `"${k}"`)
            .join(
              ", ",
            )}: this config has no schema and does not allow extra fields.`,
        ],
      };
    }
    return { valid: true, errors: [] };
  }

  let schemaObj: Record<string, unknown>;
  try {
    schemaObj = JSON.parse(
      simpleToJSONSchema({ type: "object", fields, additionalProperties }),
    );
  } catch (e) {
    return {
      valid: false,
      errors: [e instanceof Error ? e.message : String(e)],
    };
  }

  // Sparse values don't carry every required key (inheritance does), so drop
  // `required` unless validating a fully-resolved value. Recurse so a NESTED
  // required (e.g. a raw JSON Schema field with its own required[]) doesn't
  // reject a partial nested object that inherits the rest of its keys.
  if (!requireAll) stripRequiredDeep(schemaObj);

  try {
    const ajv = new Ajv({ strictSchema: false });
    const validate = ajv.compile(schemaObj);
    const valid = validate(data);
    return {
      valid: !!valid,
      errors:
        validate.errors?.map((v) => {
          const field =
            v.instancePath?.replace(/^\//, "") ||
            (v.params as { missingProperty?: string })?.missingProperty ||
            (v.params as { additionalProperty?: string })?.additionalProperty ||
            "";
          const where = field ? `"${field}" ` : "";
          return `${where}${v.message ?? "is invalid"}`;
        }) ?? [],
    };
  } catch (e) {
    return {
      valid: false,
      errors: [e instanceof Error ? e.message : String(e)],
    };
  }
}
