import { FeatureValueType, SchemaField } from "shared/types/feature";

// `source` is the lineage config that set the value.
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
  fieldCount: number;
};

// Always `required`: children are value-patches, not optional fields.
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
  { value: "array", label: "Array" },
  { value: "any", label: "Any" },
];

// key | value | type | source | actions. Right-hand columns are fixed-width so
// they line up across rows (each row is its own grid); value (1fr) absorbs slack.
export const FIELD_GRID_TEMPLATE =
  "minmax(110px, 200px) minmax(120px, 1fr) 110px 150px 150px";

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

// Non-primitive type picks, each backed by a canonical raw JSON Schema.
export const JSON_SCHEMA_PRESETS = {
  json: { type: "object" },
  array: { type: "array" },
  any: {},
} as const;
export type PresetKey = keyof typeof JSON_SCHEMA_PRESETS;

const PRESET_LABELS: Record<PresetKey, string> = {
  json: "JSON",
  array: "array",
  any: "any",
};

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

// Read-only dropdown option for a schema no standard type can represent.
export const OTHER_TYPE_VALUE = "other";

// Best-fit dropdown option for a field, tolerating extra constraints and
// `| null`; "other" when no single option fits (unions, oneOf, etc.).
export function fieldTypeSelectValue(field: SchemaField): string {
  if (field.jsonSchema === undefined) return field.type;
  let parsed: unknown;
  try {
    parsed = JSON.parse(field.jsonSchema);
  } catch {
    return OTHER_TYPE_VALUE;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return OTHER_TYPE_VALUE;
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.type === undefined) {
    // Empty schema is "any"; untyped-but-non-empty is custom.
    return Object.keys(obj).length === 0 ? "any" : OTHER_TYPE_VALUE;
  }
  const types = (Array.isArray(obj.type) ? obj.type : [obj.type]).filter(
    (t) => t !== "null",
  );
  if (types.length !== 1) return OTHER_TYPE_VALUE;
  switch (types[0]) {
    case "string":
      return "string";
    case "integer":
      return "integer";
    case "number":
      return "float";
    case "boolean":
      return "boolean";
    case "object":
      return "json";
    case "array":
      return "array";
    default:
      return OTHER_TYPE_VALUE;
  }
}

// Collapse a raw schema that's really a simple type back to that type.
export function normalizeField(f: SchemaField): SchemaField {
  if (f.jsonSchema === undefined) return f;
  const simple = simpleTypeFromJsonSchema(f.jsonSchema);
  if (simple === null) return f;
  return { ...f, type: simple, jsonSchema: undefined };
}

// "advanced" for an irreducible raw JSON Schema.
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

export function typeDefault(field: SchemaField | null): unknown {
  if (!field) return {};
  const preset = presetKeyFromField(field);
  if (preset === "json") return {};
  if (preset === "array") return [];
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

// Value-editor surface from a schema's top-level type; only structured shapes
// (object/array, multi-type unions, "any") use the JSON editor.
function jsonSchemaValueType(
  jsonSchema: string,
): "string" | "number" | "boolean" | "json" {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonSchema);
  } catch {
    return "json";
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return "json";
  }
  const rawType = (parsed as { type?: unknown }).type;
  const types = (Array.isArray(rawType) ? rawType : [rawType]).filter(
    (t) => t !== "null",
  );
  if (types.length !== 1) return "json";
  switch (types[0]) {
    case "string":
      return "string";
    case "integer":
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    default:
      return "json";
  }
}

export function fieldValueType(
  field: SchemaField | null,
): "string" | "number" | "boolean" | "json" {
  if (!field) return "json";
  if (field.jsonSchema !== undefined)
    return jsonSchemaValueType(field.jsonSchema);
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

export function isJsonField(field: SchemaField | null): boolean {
  return fieldValueType(field) === "json";
}

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
