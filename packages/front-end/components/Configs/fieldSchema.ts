import { FeatureValueType, SchemaField } from "shared/types/feature";
import {
  JSON_SCHEMA_PRESETS,
  PresetKey,
  blankField,
  normalizeField,
  presetKeyFromField,
  presetSchemaString,
  simpleSchemaFieldToJSONSchema,
} from "shared/util";

// The schema/value conversion core lives in `shared/util/config-schema` so the
// REST API can reuse it. Re-exported here so existing editor imports of
// `@/components/Configs/fieldSchema` keep resolving to one place.
export {
  blankField,
  JSON_SCHEMA_PRESETS,
  normalizeField,
  presetKeyFromField,
  presetSchemaString,
};
export type { PresetKey };

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
  // Own schema field keys (the fields this config declares itself). Used to
  // preview "base wins" reconciliation in the editor.
  fieldKeys?: string[];
  // Composition mixins: the config keys this node layers on top of its `parent`
  // spine. Shown as same-level chips on the node (not nested tree branches).
  extendsKeys?: string[];
  // Ordered env/project variant selection — present only on a base config. Drives
  // the editor's env-selector tab group (each entry points at a flavor child
  // config, by key, for a matching environment/project scope).
  scopedOverrides?: {
    config: string;
    environments?: string[];
    projects?: string[];
  }[];
  // Self-describing flavor marker — present only on an env/project flavor. Lets
  // the tree group it under an "Environments" label under its parent instead of
  // rendering it as a plain child node.
  scopedConfig?: {
    parent: string;
    environments?: string[];
    projects?: string[];
  } | null;
  // Own value keys that no longer conform to the effective schema ("incompatible,
  // must fix"). Non-empty flags the node in the tree.
  incompatibleFields?: string[];
  // Own value keys the effective schema no longer declares (an ancestor removed
  // the field). Still served, but unvalidated and read as null by rules.
  orphanedFields?: string[];
  // Effective invariants (inherited + own) failing against the node's resolved
  // value. Non-empty flags the node in the tree.
  invariantViolations?: { name: string; message: string }[];
};

export const FIELD_TYPE_OPTIONS = [
  { value: "string", label: "String" },
  { value: "integer", label: "Integer" },
  { value: "float", label: "Float" },
  { value: "boolean", label: "Boolean" },
  { value: "json", label: "JSON" },
  { value: "array", label: "Array" },
  { value: "any", label: "Any" },
];

// key | value | type | source | usage | actions. Right-hand columns are
// fixed-width so they line up across rows (each row is its own grid); value
// (1fr) absorbs slack.
export const FIELD_GRID_TEMPLATE =
  "minmax(110px, 200px) minmax(120px, 1fr) 110px 110px 48px 150px";

const PRESET_LABELS: Record<PresetKey, string> = {
  json: "JSON",
  array: "array",
  any: "any",
};

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

// Build a synthetic SchemaField from a FIELD_TYPE_OPTIONS token — the inverse of
// fieldTypeSelectValue. Presets (json/array/any) carry a jsonSchema; scalars set
// `type`. Used to give a custom (non-schema) override key a selectable type.
export function fieldForTypeToken(token: string): SchemaField {
  const base = blankField();
  if (token in JSON_SCHEMA_PRESETS) {
    return { ...base, jsonSchema: presetSchemaString(token as PresetKey) };
  }
  return { ...base, type: token as SchemaField["type"], jsonSchema: undefined };
}

// Best-fit FIELD_TYPE_OPTIONS token for a raw JS value, to seed a custom key's
// type selector from its current value. Defaults to "string".
export function typeTokenFromValue(value: unknown): string {
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") {
    return Number.isInteger(value) ? "integer" : "float";
  }
  if (Array.isArray(value)) return "array";
  if (value !== null && typeof value === "object") return "json";
  return "string";
}

// Whether a field admits `null` — either via the `nullable` flag or a raw schema
// whose top-level `type` is a union that includes `"null"`.
export function fieldIsNullable(f: SchemaField | null): boolean {
  if (!f) return false;
  if (f.nullable === true) return true;
  if (f.jsonSchema === undefined) return false;
  try {
    const t = (JSON.parse(f.jsonSchema) as { type?: unknown }).type;
    return Array.isArray(t) && t.includes("null");
  } catch {
    return false;
  }
}

// Base-type label for a raw schema, ignoring validation keywords (min/max,
// pattern, format, …) and a `| null` union. Returns null only for genuinely
// exotic shapes — no single type, or a structured object/array — which warrant
// the "advanced" badge. (Bare object/array presets are handled before this.)
function rawSchemaBaseLabel(jsonSchema: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonSchema);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    return null;
  const obj = parsed as Record<string, unknown>;
  const rawType = obj.type;
  const types = (Array.isArray(rawType) ? rawType : [rawType]).filter(
    (t) => t !== "null",
  );
  if (types.length !== 1) return null;
  let label: string;
  switch (types[0]) {
    case "string":
      label = "string";
      break;
    case "integer":
      label = "integer";
      break;
    case "number":
      label =
        obj.multipleOf === 1 || obj.format === "number" ? "integer" : "float";
      break;
    case "boolean":
      label = "boolean";
      break;
    default:
      // object / array with structural keys, or an unknown type → exotic.
      return null;
  }
  return Array.isArray(obj.enum) && obj.enum.length > 0
    ? `enum<${label}>`
    : label;
}

// "advanced" only for exotic type shapes; plain validations keep the base type.
export function fieldTypeLabel(f: SchemaField | null): string {
  if (!f) return "—";
  const reduced = normalizeField(f);
  const preset = presetKeyFromField(reduced);
  let label: string;
  if (preset !== null) label = PRESET_LABELS[preset];
  else if (reduced.jsonSchema !== undefined) {
    const raw = rawSchemaBaseLabel(reduced.jsonSchema);
    if (raw === null) return "advanced";
    label = raw;
  } else if (reduced.enum.length > 0) label = `enum<${reduced.type}>`;
  else label = reduced.type;
  if (fieldIsNullable(reduced)) label += " | null";
  return label;
}

// Pretty-printed JSON Schema for a single field (raw schema verbatim, else
// derived from the simple form). Returns null when there's nothing beyond a bare
// `type` worth inspecting (`description`/`default` already surface elsewhere), so
// rows only offer a schema inspector when the type label hides real structure or
// validation (nested object/array, enum, bounds, format, unions, …).
export function fieldSchemaPreview(f: SchemaField | null): string | null {
  if (!f) return null;
  const node = simpleSchemaFieldToJSONSchema(normalizeField(f));
  const interesting = Object.keys(node).filter(
    (k) => k !== "type" && k !== "description" && k !== "default",
  );
  if (interesting.length === 0) return null;
  return JSON.stringify(node, null, 2);
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
