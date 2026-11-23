import Ajv, { ErrorObject } from "ajv";
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

// The checkable part of a value: reference-backed keys are exempt (their
// resolved type is unknown), and `$extends` is a merge directive, not data.
function checkableValue(value: Record<string, unknown>): {
  data: Record<string, unknown>;
  refKeys: string[];
} {
  const data: Record<string, unknown> = {};
  const refKeys: string[] = [];
  for (const [k, v] of Object.entries(value)) {
    if (k === CONSTANT_EXTENDS_KEY) continue;
    if (valueHasReferenceToken(v)) refKeys.push(k);
    else data[k] = v;
  }
  return { data, refKeys };
}

// Compiles the effective schema for a value; throws when it can't. Sparse values
// don't carry every required key (inheritance does), so `required` is dropped at
// every depth unless the value is fully resolved.
function compileValueSchema({
  fields,
  additionalProperties,
  requireAll,
  refKeys,
}: {
  fields: SchemaField[];
  additionalProperties: boolean;
  requireAll: boolean;
  refKeys: string[];
}): ReturnType<Ajv["compile"]> {
  const schemaObj: Record<string, unknown> = JSON.parse(
    simpleToJSONSchema({ type: "object", fields, additionalProperties }),
  );
  if (!requireAll) {
    stripRequiredDeep(schemaObj);
  } else if (Array.isArray(schemaObj.required)) {
    // A reference-backed key is present, just not checkable.
    schemaObj.required = schemaObj.required.filter(
      (k: unknown) => !refKeys.includes(k as string),
    );
  }
  // allErrors: report every violation, not just the first — callers surface
  // the full list (and the schema-break guard fingerprints it, so a masked
  // second violation would otherwise only appear once the first is fixed).
  return new Ajv({ strictSchema: false, allErrors: true }).compile(schemaObj);
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
  const { data } = checkableValue(value);
  const keys = Object.keys(data);
  if (!keys.length) return [];

  // No declared fields: the only constraint is extensibility — a non-extensible
  // config may carry no keys, so every present key is offending.
  if (!fields.length) return additionalProperties ? [] : keys;

  let validate: ReturnType<Ajv["compile"]>;
  try {
    validate = compileValueSchema({
      fields,
      additionalProperties,
      requireAll: false,
      refKeys: [],
    });
  } catch {
    // A malformed schema can't attribute a fault to a specific value key; the
    // schema itself is surfaced as invalid elsewhere.
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
// Recursively remove `required` from a JSON Schema — sparse-patch validation
// doesn't enforce completeness at any depth. Only descends into subschema
// positions, so a field literally named "required" is untouched.
function stripRequiredDeep(schema: unknown): void {
  if (!schema || typeof schema !== "object") return;
  if (Array.isArray(schema)) {
    schema.forEach(stripRequiredDeep);
    return;
  }
  const s = schema as Record<string, unknown>;
  delete s.required;
  // `dependentRequired` (2019-09) and draft-07's array-form `dependencies` are
  // the same completeness constraint in conditional form. (The Ajv instance
  // below is draft-07, so `dependencies` is the spelling it actually enforces.)
  delete s.dependentRequired;
  if (s.dependencies && typeof s.dependencies === "object") {
    const deps = s.dependencies as Record<string, unknown>;
    for (const [k, dep] of Object.entries(deps)) {
      if (Array.isArray(dep)) delete deps[k];
      else stripRequiredDeep(dep);
    }
  }
  for (const k of ["properties", "patternProperties", "dependentSchemas"]) {
    if (s[k] && typeof s[k] === "object") {
      for (const sub of Object.values(s[k] as Record<string, unknown>)) {
        stripRequiredDeep(sub);
      }
    }
  }
  if (s.items) stripRequiredDeep(s.items);
  if (s.additionalProperties && typeof s.additionalProperties === "object") {
    stripRequiredDeep(s.additionalProperties);
  }
  // `then`/`else` demand completeness once triggered, so strip inside them. Do
  // NOT descend `if` (its `required` is the condition's trigger — stripping it
  // makes the branch fire for every value) or `not` (a `required` under
  // negation is a PROHIBITION — stripping turns `not:{required:[...]}` into
  // `not:{}`, which rejects everything). `contains`/`items` element schemas
  // apply to arrays, which replace wholesale (never merged sparsely), but
  // `items` descent predates this and is kept as-is.
  for (const k of ["then", "else"]) {
    if (s[k]) stripRequiredDeep(s[k]);
  }
  for (const k of ["allOf", "anyOf", "oneOf"]) {
    if (Array.isArray(s[k])) (s[k] as unknown[]).forEach(stripRequiredDeep);
  }
}

// Follows the per-key lines when a top-level key isn't declared. Each key keeps
// its own line, since the schema-break guard matches lines exactly.
export const UNDECLARED_FIELDS_FIX =
  "Add these fields to the schema, or allow extra fields on the base Config.";

export type ConfigValueIssue = { path: string; message: string };

// The top-level key an error is about: the first pointer segment, unescaped,
// or for an error on the object itself, the property it names.
function topLevelKey(err: ErrorObject): string {
  const first = (err.instancePath ?? "").split("/")[1];
  if (first !== undefined) return first.replace(/~1/g, "/").replace(/~0/g, "~");
  const params = err.params as {
    missingProperty?: string;
    additionalProperty?: string;
  };
  return params.missingProperty ?? params.additionalProperty ?? "";
}

// Ajv's wording names the parent object and hides the offending key or the
// allowed values, so these keywords say what to fix instead.
function configValueIssue(err: ErrorObject): ConfigValueIssue {
  const path = err.instancePath?.replace(/^\//, "") ?? "";
  const at = (key: string) => (path ? `${path}/${key}` : key);
  const params = err.params as {
    missingProperty?: string;
    additionalProperty?: string;
    allowedValues?: unknown[];
    multipleOf?: number;
  };
  if (err.keyword === "required" && params.missingProperty) {
    return { path: at(params.missingProperty), message: "is required" };
  }
  if (err.keyword === "additionalProperties" && params.additionalProperty) {
    return {
      path: at(params.additionalProperty),
      message: "isn't in the schema",
    };
  }
  if (err.keyword === "multipleOf" && path && params.multipleOf === 1) {
    return { path, message: "must be an integer" };
  }
  if (err.keyword === "enum" && path && params.allowedValues) {
    const allowed = params.allowedValues.map((v) => JSON.stringify(v));
    return { path, message: `must be one of ${allowed.join(", ")}` };
  }
  return { path, message: err.message ?? "is invalid" };
}

function describeConfigValueError(err: ErrorObject): string {
  const { path, message } = configValueIssue(err);
  return `${path ? `"${path}" ` : ""}${message}`;
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
  const { data, refKeys } = checkableValue(value);

  // No declared fields: the only constraint is extensibility (a non-extensible
  // config with no schema may not carry any keys).
  if (!fields.length) {
    if (!additionalProperties && Object.keys(data).length > 0) {
      return {
        valid: false,
        errors: [
          ...Object.keys(data).map((k) => `"${k}" isn't in the schema`),
          UNDECLARED_FIELDS_FIX,
        ],
      };
    }
    return { valid: true, errors: [] };
  }

  try {
    const validate = compileValueSchema({
      fields,
      additionalProperties,
      requireAll,
      refKeys,
    });
    const valid = validate(data);
    const errors = validate.errors ?? [];
    const undeclaredAtTop = errors.some(
      (e) => e.keyword === "additionalProperties" && !e.instancePath,
    );
    return {
      valid: !!valid,
      errors: [
        ...new Set([
          ...errors.map(describeConfigValueError),
          ...(undeclaredAtTop ? [UNDECLARED_FIELDS_FIX] : []),
        ]),
      ],
    };
  } catch (e) {
    return {
      valid: false,
      errors: [e instanceof Error ? e.message : String(e)],
    };
  }
}

// A fully-resolved value's schema issues (required enforced, extra keys
// allowed), grouped by top-level key so each can mark its key's row.
export function collectConfigValueIssuesByKey({
  value,
  fields,
}: {
  value: Record<string, unknown>;
  fields: SchemaField[];
}): Map<string, ConfigValueIssue[]> {
  const byKey = new Map<string, ConfigValueIssue[]>();
  if (!fields.length) return byKey;
  const { data, refKeys } = checkableValue(value);
  let validate: ReturnType<Ajv["compile"]>;
  try {
    validate = compileValueSchema({
      fields,
      additionalProperties: true,
      requireAll: true,
      refKeys,
    });
  } catch {
    return byKey;
  }
  if (validate(data)) return byKey;
  for (const err of validate.errors ?? []) {
    const issue = configValueIssue(err);
    const key = topLevelKey(err);
    if (!key) continue;
    const list = byKey.get(key) ?? [];
    if (
      !list.some((i) => i.path === issue.path && i.message === issue.message)
    ) {
      byKey.set(key, [...list, issue]);
    }
  }
  return byKey;
}
