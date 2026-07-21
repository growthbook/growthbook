import { SchemaField } from "shared/types/feature";
import { CONSTANT_EXTENDS_KEY } from "../../constants";
import { blankField, JSON_SCHEMA_PRESETS } from "./fields";
import { SchemaConverter } from "./types";

// Schema inference from a concrete JSON value — the "language" backing the live
// value→schema assist (and a useful default when no schema is provided).

// Reference tokens (`@const:key` / `@config:key`) resolve to whatever the target
// holds, so we never pin them to a concrete primitive type during inference.
function isReferenceToken(s: string): boolean {
  // Require an actual key after the namespace — a keyless `@config:` is not a
  // resolvable token and shouldn't be inferred as `any`.
  return /^@(?:const|config):[a-z0-9][a-z0-9_-]*$/.test(s);
}

// Best-guess a single field definition from a concrete JS value. Conservative by
// design: we never infer enums/bounds from a single sample, and arrays/objects
// fall back to the raw-JSON-Schema presets.
export function inferFieldFromValue(key: string, value: unknown): SchemaField {
  const field = blankField();
  field.key = key;

  if (value === null) {
    // Low-confidence: underlying type is unknown, so default to a nullable string.
    field.type = "string";
    field.nullable = true;
    return field;
  }
  if (typeof value === "string") {
    if (isReferenceToken(value)) {
      field.jsonSchema = JSON.stringify(JSON_SCHEMA_PRESETS.any);
    } else {
      field.type = "string";
    }
    return field;
  }
  if (typeof value === "number") {
    field.type = Number.isInteger(value) ? "integer" : "float";
    return field;
  }
  if (typeof value === "boolean") {
    field.type = "boolean";
    return field;
  }
  if (Array.isArray(value)) {
    field.jsonSchema = JSON.stringify(JSON_SCHEMA_PRESETS.array);
    return field;
  }
  field.jsonSchema = JSON.stringify(JSON_SCHEMA_PRESETS.json);
  return field;
}

// Infer fields from a JSON value object, skipping `$extends` and any keys already
// covered up the chain / by this config (`knownKeys`).
export function inferFieldsFromValue(
  obj: Record<string, unknown>,
  knownKeys: ReadonlySet<string> = new Set(),
): SchemaField[] {
  const out: SchemaField[] = [];
  for (const [key, value] of Object.entries(obj)) {
    if (key === CONSTANT_EXTENDS_KEY || knownKeys.has(key)) continue;
    out.push(inferFieldFromValue(key, value));
  }
  return out;
}

// Best-guess JSON Schema sub-schema for a concrete value — the sibling of
// `inferFieldFromValue`, but emitting raw JSON Schema for splicing directly into
// a schema document the user is editing.
export function inferJsonSchemaForValue(
  value: unknown,
): Record<string, unknown> {
  if (value === null) return { type: ["string", "null"] };
  if (typeof value === "string") {
    return isReferenceToken(value) ? {} : { type: "string" };
  }
  if (typeof value === "number") {
    return { type: Number.isInteger(value) ? "integer" : "number" };
  }
  if (typeof value === "boolean") return { type: "boolean" };
  if (Array.isArray(value)) return { type: "array" };
  return { type: "object" };
}

// The live value→schema converter backing the JSON editor's left column.
// Input-only: there's no meaningful `fromFields` (schema → concrete value).
export const jsonValueConverter: SchemaConverter = {
  id: "json-value",
  label: "JSON value",
  toFields(input) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(input);
    } catch {
      return { fields: [], error: "Invalid JSON", warnings: [] };
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { fields: [], error: "Expected a JSON object", warnings: [] };
    }
    return {
      fields: inferFieldsFromValue(parsed as Record<string, unknown>),
      error: null,
      warnings: [],
    };
  },
};
