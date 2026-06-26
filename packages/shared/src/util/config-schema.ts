import { SchemaField } from "shared/types/feature";
import { CONSTANT_EXTENDS_KEY } from "../constants";

// Portable schema/value import-export core, shared between the front-end editor
// and (eventually) the REST API. Everything here is pure (no React, no DOM, no
// network) so the same value→schema inference and JSON-Schema↔SchemaField
// round-tripping runs identically in both places. Keep it that way: callers do
// presentation/labels; this module does the conversions.

// Reference tokens (`@const:key` / `@config:key`) resolve to whatever the target
// holds, so we never pin them to a concrete primitive type during inference.
function isReferenceToken(s: string): boolean {
  return /^@(?:const|config):/.test(s);
}

// A field's `required`/`nullable` are composition concerns; default to required
// (config children are value-patches, not optional fields).
export const blankField = (): SchemaField => ({
  key: "",
  type: "string",
  required: true,
  default: "",
  description: "",
  enum: [],
});

// SchemaField["type"] each JSON Schema primitive maps back to.
const JSON_SCHEMA_SIMPLE_TYPES: Record<string, SchemaField["type"]> = {
  string: "string",
  integer: "integer",
  number: "float",
  boolean: "boolean",
};

// Non-primitive type picks, each backed by a canonical raw JSON Schema.
export const JSON_SCHEMA_PRESETS = {
  json: { type: "object" },
  array: { type: "array" },
  any: {},
} as const;
export type PresetKey = keyof typeof JSON_SCHEMA_PRESETS;

// Sorted-key stringify so preset detection ignores key order.
function canonicalJSON(v: unknown): string {
  return JSON.stringify(v, (_k, val) =>
    val && typeof val === "object" && !Array.isArray(val)
      ? Object.fromEntries(
          Object.entries(val as Record<string, unknown>).sort(([a], [b]) =>
            a.localeCompare(b),
          ),
        )
      : val,
  );
}

export function presetKeyFromField(f: SchemaField | null): PresetKey | null {
  if (!f || f.jsonSchema === undefined) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(f.jsonSchema);
  } catch {
    return null;
  }
  const target = canonicalJSON(parsed);
  return (
    (Object.keys(JSON_SCHEMA_PRESETS) as PresetKey[]).find(
      (key) => canonicalJSON(JSON_SCHEMA_PRESETS[key]) === target,
    ) ?? null
  );
}

export function presetSchemaString(key: PresetKey): string {
  return JSON.stringify(JSON_SCHEMA_PRESETS[key], null, 2);
}

// Keys a simple-mode field can faithfully round-trip through JSON Schema (the
// inverse of `simpleSchemaFieldToJSONSchema`). A raw schema using only these can
// be collapsed back to simple form; anything else stays "advanced".
const SIMPLE_SCHEMA_KEYS = new Set([
  "type",
  "description",
  "default",
  "enum",
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "multipleOf",
  "format",
]);

// Set an optional field key only when it carries a meaningful value; otherwise
// delete it so the field omits the key entirely (rather than persisting
// `nullable: false` or `min: undefined`, which would dirty the draft diff).
function setOptionalFlag<K extends "nullable" | "min" | "max">(
  field: SchemaField,
  key: K,
  value: SchemaField[K] | undefined,
): void {
  if (value === undefined) delete field[key];
  else field[key] = value;
}

// Collapse a raw schema back to its canonical simple/preset form. Handles a bare
// `{type:"string"}`, a `T | null` union (lifted to the `nullable` flag), a
// nullable object/array preset, and a primitive carrying only simple-mode
// constraints (description, default, enum, bounds). Anything else (nested
// shapes, real unions, unknown keywords) is left untouched so it stays
// "advanced".
export function normalizeField(f: SchemaField): SchemaField {
  if (f.jsonSchema === undefined) return f;
  let parsed: unknown;
  try {
    parsed = JSON.parse(f.jsonSchema);
  } catch {
    return f;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return f;
  const obj = parsed as Record<string, unknown>;
  const keys = Object.keys(obj);

  const rawType = obj.type;
  const arr = Array.isArray(rawType) ? rawType : [rawType];
  const hasNull = arr.includes("null");
  const nonNull = arr.filter((t) => t !== "null");
  if (nonNull.length !== 1) return f;
  const base = nonNull[0];
  const nullable = f.nullable === true || hasNull;

  if (base === "object" || base === "array") {
    // Only a bare preset (optionally `| null`) reduces; structural keys are kept.
    if (keys.length !== 1) return f;
    const reduced: SchemaField = {
      ...f,
      jsonSchema: presetSchemaString(base === "object" ? "json" : "array"),
    };
    setOptionalFlag(reduced, "nullable", nullable || undefined);
    return reduced;
  }

  const simple =
    typeof base === "string" ? JSON_SCHEMA_SIMPLE_TYPES[base] : undefined;
  if (simple === undefined) return f;
  // Reduce a primitive only when every keyword maps to a simple-mode control,
  // and the integer markers are exactly what we emit (else we'd lose meaning).
  if (!keys.every((k) => SIMPLE_SCHEMA_KEYS.has(k))) return f;
  if (obj.multipleOf !== undefined && obj.multipleOf !== 1) return f;
  if (obj.format !== undefined && obj.format !== "number") return f;
  // `{type:"number"}` with an integer marker is really an integer.
  const type: SchemaField["type"] =
    simple === "float" && (obj.multipleOf === 1 || obj.format === "number")
      ? "integer"
      : simple;

  const enumValues = Array.isArray(obj.enum)
    ? obj.enum.map((v) => (typeof v === "string" ? v : JSON.stringify(v)))
    : f.enum;
  const minRaw = type === "string" ? obj.minLength : obj.minimum;
  const maxRaw = type === "string" ? obj.maxLength : obj.maximum;
  const min = typeof minRaw === "number" ? minRaw : f.min;
  const max = typeof maxRaw === "number" ? maxRaw : f.max;

  const reduced: SchemaField = {
    ...f,
    type,
    enum: enumValues,
    description:
      typeof obj.description === "string" ? obj.description : f.description,
    default:
      obj.default === undefined
        ? f.default
        : typeof obj.default === "string"
          ? obj.default
          : JSON.stringify(obj.default),
  };
  // Optional keys default to absent, not `false`/`undefined`, so a reduced field
  // serializes to the same canonical shape the editor started from (no spurious
  // `nullable: false` / empty-bound diffs on save).
  delete reduced.jsonSchema;
  setOptionalFlag(reduced, "nullable", nullable || undefined);
  setOptionalFlag(reduced, "min", typeof min === "number" ? min : undefined);
  setOptionalFlag(reduced, "max", typeof max === "number" ? max : undefined);
  return reduced;
}

// Canonical form for equality: reduce raw schemas via `normalizeField`, then
// drop optional keys that carry no meaning (`nullable: false`, empty bounds, a
// `jsonSchema` already collapsed away). Two fields with the same canonical form
// are semantically identical even if one was stored in a redundant shape (e.g.
// an explicit `nullable: false` left over from an older editor).
function canonicalField(f: SchemaField): SchemaField {
  const out = { ...normalizeField(f) };
  if (out.nullable !== true) delete out.nullable;
  if (typeof out.min !== "number") delete out.min;
  if (typeof out.max !== "number") delete out.max;
  if (out.jsonSchema === undefined) delete out.jsonSchema;
  return out;
}

// Whether two fields mean the same thing (ignoring redundant stored keys).
export function fieldsCanonicallyEqual(
  a: SchemaField,
  b: SchemaField,
): boolean {
  return canonicalJSON(canonicalField(a)) === canonicalJSON(canonicalField(b));
}

// Reconcile edited fields against what's stored so an unchanged field keeps its
// exact stored bytes. Round-tripping a config's schema through JSON Schema
// (`simpleToJSONSchema` → edit → `jsonSchemaStringToFields`) canonicalizes each
// field; reusing the stored object whenever the meaning is unchanged keeps a
// no-op save a true no-op (no spurious draft diffs), while genuinely edited
// fields persist in their clean canonical form.
export function reconcileSchemaFields(
  storedFields: SchemaField[],
  editedFields: SchemaField[],
): SchemaField[] {
  const storedByKey = new Map(storedFields.map((f) => [f.key, f]));
  return editedFields.map((edited) => {
    const stored = storedByKey.get(edited.key);
    return stored && fieldsCanonicallyEqual(stored, edited) ? stored : edited;
  });
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

// Parse a JSON Schema document string into a config's own `SchemaField[]`. Each
// top-level property becomes a field (its raw sub-schema, collapsed by
// `normalizeField` when it maps to a simple type); the `required` array drives
// each field's required flag. Inverse of `simpleToJSONSchema` for the shapes the
// editor round-trips.
export function jsonSchemaStringToFields(text: string): {
  fields: SchemaField[];
  error: string | null;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text || "{}");
  } catch {
    return { fields: [], error: "Invalid JSON" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { fields: [], error: "Schema must be a JSON object" };
  }
  const obj = parsed as Record<string, unknown>;
  const props = obj.properties;
  if (props === undefined) return { fields: [], error: null };
  if (!props || typeof props !== "object" || Array.isArray(props)) {
    return { fields: [], error: '"properties" must be an object' };
  }
  const required = Array.isArray(obj.required)
    ? (obj.required.filter((r) => typeof r === "string") as string[])
    : [];
  const fields = Object.entries(props as Record<string, unknown>).map(
    ([key, sub]) =>
      normalizeField({
        key,
        type: "string",
        required: required.includes(key),
        default: "",
        description: "",
        enum: [],
        jsonSchema: JSON.stringify(sub),
      }),
  );
  return { fields, error: null };
}

export type SchemaImportResult = {
  fields: SchemaField[];
  warnings: string[];
};

// A pluggable source format that compiles into a config's own `SchemaField[]`.
// The live value→schema inference (`jsonValueImporter`) is the first one; future
// importers will parse JSON Schema, TypeScript, Python, Go, and protobuf typedefs
// into the same `SchemaField[]` shape so the editor's right column is agnostic to
// where the definitions came from.
export type SchemaImporter = {
  id: string;
  label: string;
  parse: (input: string) => SchemaImportResult;
};

// The live value→schema importer backing the JSON editor's left column.
export const jsonValueImporter: SchemaImporter = {
  id: "json-value",
  label: "JSON value",
  parse(input) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(input);
    } catch {
      return { fields: [], warnings: ["Invalid JSON"] };
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { fields: [], warnings: ["Expected a JSON object"] };
    }
    return {
      fields: inferFieldsFromValue(parsed as Record<string, unknown>),
      warnings: [],
    };
  },
};

// Registry of source formats. Future entries: "json-schema", "typescript",
// "python", "go", "protobuf" — each implementing `parse(text) => SchemaField[]`.
export const SCHEMA_IMPORTERS: SchemaImporter[] = [jsonValueImporter];
