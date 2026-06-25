import { FeatureValueType, SchemaField } from "shared/types/feature";

// A single resolved field in a config: its effective value plus the source
// config (in the inheritance chain) that set it.
export type ResolvedField = {
  key: string;
  field: SchemaField | null;
  value: unknown;
  source: string | null;
};

export type LineageNode = {
  key: string;
  name: string;
  parentKey: string | null;
};

// A blank field: a clean typedef, no prebaked bounds. Always `required` —
// children are value-patches, not optional fields.
export const blankField = (): SchemaField => ({
  key: "",
  type: "string",
  required: true,
  default: "",
  description: "",
  enum: [],
});

export const FIELD_TYPE_OPTIONS = [
  { value: "string", label: "String" },
  { value: "integer", label: "Integer" },
  { value: "float", label: "Float" },
  { value: "boolean", label: "Boolean" },
  { value: "json", label: "JSON" },
  { value: "array-primitives", label: "Array of primitives" },
  { value: "any", label: "Any" },
];

// Shared fixed column widths so the Form-tab header, value rows, and the insert
// row all line up on key / value / type.
export const FIELD_COLS = { key: 200, value: 300, type: 150 };

// If a raw JSON Schema is just an unambiguous primitive (e.g. `{"type":"string"}`)
// return the equivalent simple type, so we don't surface it as "advanced". Returns
// null the moment there's any extra constraint (enum, format, properties, unions…),
// which is what actually warrants the advanced treatment.
const JSON_SCHEMA_SIMPLE_TYPES: Record<string, SchemaField["type"]> = {
  string: "string",
  integer: "integer",
  number: "float",
  boolean: "boolean",
};
function simpleTypeFromJsonSchema(
  jsonSchema: string,
): SchemaField["type"] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonSchema);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const keys = Object.keys(parsed);
  if (keys.length !== 1 || keys[0] !== "type") return null;
  const t = (parsed as { type: unknown }).type;
  return typeof t === "string" ? (JSON_SCHEMA_SIMPLE_TYPES[t] ?? null) : null;
}

// Non-primitive picks offered alongside the simple types. Each is backed by a
// canonical raw JSON Schema (so it round-trips through `jsonSchema`), but we
// surface them as first-class options with friendly labels rather than burying
// them behind "advanced".
export const JSON_SCHEMA_PRESETS = {
  json: { type: "object" },
  "array-primitives": {
    type: "array",
    items: { type: ["string", "number", "boolean", "null"] },
  },
  any: {},
} as const;
export type PresetKey = keyof typeof JSON_SCHEMA_PRESETS;

const PRESET_LABELS: Record<PresetKey, string> = {
  json: "JSON",
  "array-primitives": "array",
  any: "any",
};

// Stable stringify (sorted object keys) so preset detection ignores key order.
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

// Collapse a field whose raw JSON Schema is really just a simple type back into
// simple form (drops `jsonSchema`, sets `type`). No-op for genuinely advanced
// schemas and for simple fields.
export function normalizeField(f: SchemaField): SchemaField {
  if (f.jsonSchema === undefined) return f;
  const simple = simpleTypeFromJsonSchema(f.jsonSchema);
  if (simple === null) return f;
  return { ...f, type: simple, jsonSchema: undefined };
}

// tsc-style label for a field's type, including the nullable (`| null`) modifier;
// "advanced" only when a raw JSON Schema is set that can't be reduced to a simple
// type. Config fields are always required (present in the resolved object), so
// there's no `| undefined`.
export function fieldTypeLabel(f: SchemaField | null): string {
  if (!f) return "—";
  const reduced = normalizeField(f);
  const preset = presetKeyFromField(reduced);
  let label: string;
  if (preset !== null) label = PRESET_LABELS[preset];
  else if (reduced.jsonSchema !== undefined) return "advanced";
  else label = reduced.type;
  if (reduced.nullable) label += " | null";
  return label;
}

// Every field resolves to a concrete value — there is no "unset". A field that
// no config in the chain sets falls back to its type's default: string "",
// boolean false, number 0, JSON {}, array [], any null.
export function typeDefault(field: SchemaField | null): unknown {
  if (!field) return {};
  const preset = presetKeyFromField(field);
  if (preset === "json") return {};
  if (preset === "array-primitives") return [];
  if (preset === "any") return null;
  if (field.jsonSchema !== undefined) return {};
  switch (field.type) {
    case "boolean":
      return false;
    case "integer":
    case "float":
      return 0;
    default:
      return "";
  }
}

// Map a field to the FeatureValueField editor surface. Anything jsonSchema-backed
// (JSON/array/any presets + raw schemas) edits as JSON.
export function fieldValueType(
  field: SchemaField | null,
): "string" | "number" | "boolean" | "json" {
  if (!field || field.jsonSchema !== undefined) return "json";
  switch (field.type) {
    case "boolean":
      return "boolean";
    case "integer":
    case "float":
      return "number";
    default:
      return "string";
  }
}

// A field is edited as raw JSON only when it has no simple type (a raw per-field
// JSON Schema, or no schema at all). Simple types get a plain input.
export function isJsonField(field: SchemaField | null): boolean {
  return !field || field.jsonSchema !== undefined;
}

// Resolved values are parsed (unknown); ValueDisplay wants the string form for
// the given surface: raw text for string, JSON text for json, "true"/"false"
// for boolean, the numeric literal for number.
export function valueToDisplayString(
  value: unknown,
  valueType: FeatureValueType,
): string {
  switch (valueType) {
    case "json":
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "number":
      return value === null ? "null" : String(value);
    default:
      return typeof value === "string" ? value : JSON.stringify(value);
  }
}
