import { SchemaField } from "shared/types/feature";

// The internal model + the JSON-Schema-shaped helpers every converter depends
// on. Pure (no React/DOM/network): the same logic runs in the browser editor
// and (eventually) the REST API. JSON Schema is the canonical pivot — language
// importers convert to/from JSON Schema, and this is the one place that maps
// JSON Schema <-> SchemaField, so adding a language never touches this file.

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
  // `{type:"number"}` with an integer marker — or an all-integer enum — is
  // really an integer.
  const impliesInteger =
    obj.multipleOf === 1 ||
    obj.format === "number" ||
    (Array.isArray(obj.enum) &&
      obj.enum.some((v) => v !== null) &&
      obj.enum.every(
        (v) => v === null || (typeof v === "number" && Number.isInteger(v)),
      ));
  const type: SchemaField["type"] =
    simple === "float" && impliesInteger ? "integer" : simple;

  const enumValues = Array.isArray(obj.enum)
    ? // `null` is carried by the `nullable` flag, not as an enum member — drop
      // it so a nullable enum doesn't gain a literal `"null"` on round-trip.
      obj.enum
        .filter((v) => v !== null)
        .map((v) => (typeof v === "string" ? v : JSON.stringify(v)))
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
  else {
    // A non-reducible advanced field keeps its raw schema as a string, which
    // canonicalJSON treats opaquely — so two semantically identical fields
    // differing only in nested property order would compare unequal (spurious
    // draft churn / false contract-change). Re-serialize the parsed schema so
    // nested keys are sorted too.
    try {
      out.jsonSchema = canonicalJSON(JSON.parse(out.jsonSchema));
    } catch {
      // Malformed raw schema — leave as-is; equality falls back to byte compare.
    }
  }
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

// Stable, order-independent canonical serialization of a field set — the basis
// for the schema fingerprint and drift detection. Fields are sorted by key
// (object property order isn't meaningful) and reduced to canonical form, so a
// reorder or a cosmetic/redundant difference produces the SAME string. A single
// canonical form (description included) drives equality, reconciliation, AND
// drift, so they can never disagree — a description change IS a change;
// `diffSchemaFields` then labels whether it's contract or docs-only.
export function canonicalSchemaString(fields: SchemaField[]): string {
  const canonical = [...fields]
    .map(canonicalField)
    .sort((a, b) => a.key.localeCompare(b.key));
  return canonicalJSON(canonical);
}

// Contract-only canonical form: canonicalField minus `description`. Used to
// LABEL a diff (docs-only vs contract) and for contract equality — never for
// the fingerprint, which includes description.
function canonicalContractJSON(f: SchemaField): string {
  const out: Record<string, unknown> = { ...canonicalField(f) };
  delete out.description;
  return canonicalJSON(out);
}

// Whether two fields agree on everything that validates (type/enum/required/
// nullable/bounds/nested structure) — description may differ.
export function fieldsContractEqual(a: SchemaField, b: SchemaField): boolean {
  return canonicalContractJSON(a) === canonicalContractJSON(b);
}

export type SchemaFieldChange = {
  key: string;
  change: "added" | "removed" | "changed";
};

// Categorized field-level diff between a `stored` schema and an `incoming` one.
// `contract` changes alter what validates (type/enum/required/nullable/bounds/
// nested structure, or an added/removed field); `docs` changes are
// description-only. Detection uses the full canonical form (nothing is silently
// ignored); classification strips `description` to label each change, so callers
// can fail hard on contract drift while treating docs drift as a soft signal.
export function diffSchemaFields(
  stored: SchemaField[],
  incoming: SchemaField[],
): { contract: SchemaFieldChange[]; docs: SchemaFieldChange[] } {
  const storedByKey = new Map(stored.map((f) => [f.key, f]));
  const incomingByKey = new Map(incoming.map((f) => [f.key, f]));
  const contract: SchemaFieldChange[] = [];
  const docs: SchemaFieldChange[] = [];
  const keys = [
    ...new Set([...storedByKey.keys(), ...incomingByKey.keys()]),
  ].sort();
  for (const key of keys) {
    const a = storedByKey.get(key);
    const b = incomingByKey.get(key);
    if (a && !b) {
      contract.push({ key, change: "removed" });
    } else if (!a && b) {
      contract.push({ key, change: "added" });
    } else if (a && b && !fieldsCanonicallyEqual(a, b)) {
      const docsOnly = canonicalContractJSON(a) === canonicalContractJSON(b);
      (docsOnly ? docs : contract).push({ key, change: "changed" });
    }
  }
  return { contract, docs };
}
