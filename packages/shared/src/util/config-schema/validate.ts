import Ajv from "ajv";
import { SchemaField } from "shared/types/feature";
import { simpleToJSONSchema } from "../features";
import { CONSTANT_EXTENDS_KEY } from "../../constants";

export type ConfigValueValidationResult = {
  valid: boolean;
  errors: string[];
};

// A field value can be (or deeply contain) a reference token — a bare
// `@const:key`/`@config:key` or a `{{ @const:key }}` interpolation — which
// resolves dynamically to whatever the target holds. We can't statically
// type-check those (a `"@const:timeout"` string may resolve to an integer), so
// a value carrying any reference is exempt from type/extensibility checks here,
// mirroring how schema inference treats reference tokens as `any`.
function valueHasReferenceToken(v: unknown): boolean {
  if (typeof v === "string")
    return v.includes("@const:") || v.includes("@config:");
  if (Array.isArray(v)) return v.some(valueHasReferenceToken);
  if (v !== null && typeof v === "object")
    return Object.values(v as Record<string, unknown>).some(
      valueHasReferenceToken,
    );
  return false;
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
  // `required` unless validating a fully-resolved value.
  if (!requireAll) schemaObj.required = [];

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
