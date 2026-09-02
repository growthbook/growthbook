import { SchemaField } from "shared/types/feature";
import { simpleToJSONSchema } from "../features";
import { normalizeField } from "./fields";
import {
  FromFieldsOptions,
  SchemaConversionResult,
  SchemaConverter,
  SchemaWarning,
} from "./types";

// JSON Schema is the canonical pivot. This file holds both halves: import
// (document → fields) and export (fields → document, via `simpleToJSONSchema`).

// Backstop against pathological non-cyclic nesting; the `seen` cycle guard is the
// real protection for recursive `$defs`.
const MAX_REF_DEPTH = 12;

// Resolve a local `$ref` ("#/$defs/Name" or "#/definitions/Name") to its def
// name (JSON-Pointer-unescaped). Returns null for external/unsupported refs.
function localDefName(ref: string): string | null {
  const m = /^#\/(?:\$defs|definitions)\/(.+)$/.exec(ref);
  if (!m) return null;
  return m[1].replace(/~1/g, "/").replace(/~0/g, "~");
}

// Inline local `$ref`s against the root `$defs`/`definitions` so each field's
// stored sub-schema is self-contained (the per-field model has no shared defs).
// Bails gracefully — recording a warning, never throwing — on:
//  - external/unsupported refs (`http://…`, other-file) → `{}` (any)
//  - unresolvable refs (no matching def) → `{}` (any)
//  - recursive refs (a def reachable from itself) → `{ type: "object" }` (opaque)
//  - depth overflow → `{}` (any), with a warning
// Recurses every sub-schema-bearing keyword and strips `$defs`/`definitions`
// from the output. Keyword lists are explicit so schema-shaped VALUES (`const`,
// `enum`, `default`, `examples`) are never dereffed.

// keyword → a single schema
const SCHEMA_KEYWORDS = new Set([
  "items",
  "additionalProperties",
  "not",
  "if",
  "then",
  "else",
  "propertyNames",
  "contains",
]);
// keyword → a map of schemas
const SCHEMA_MAP_KEYWORDS = new Set([
  "properties",
  "patternProperties",
  "dependentSchemas",
]);
// keyword → a list of schemas
const SCHEMA_LIST_KEYWORDS = new Set([
  "anyOf",
  "oneOf",
  "allOf",
  "prefixItems",
]);

function derefSchema(
  node: unknown,
  defs: Record<string, unknown>,
  seen: Set<string>,
  depth: number,
  warnings: SchemaWarning[],
): unknown {
  if (depth > MAX_REF_DEPTH) {
    warnings.push({
      code: "unresolved-type",
      message: `$ref resolution exceeded the max depth of ${MAX_REF_DEPTH}; deeper sub-schemas treated as any.`,
    });
    return {};
  }
  if (Array.isArray(node)) {
    return node.map((n) => derefSchema(n, defs, seen, depth + 1, warnings));
  }
  if (!node || typeof node !== "object") return node;
  const n = node as Record<string, unknown>;

  if (typeof n.$ref === "string") {
    const ref = n.$ref;
    const name = localDefName(ref);
    if (name === null) {
      warnings.push({
        code: "unresolved-type",
        message: `External or unsupported $ref "${ref}" can't be resolved; treated as any.`,
      });
      return {};
    }
    if (seen.has(name)) {
      warnings.push({
        code: "unresolved-type",
        message: `Recursive $ref "${ref}"; treated as an opaque object.`,
      });
      return { type: "object" };
    }
    if (!(name in defs)) {
      warnings.push({
        code: "unresolved-type",
        message: `Unresolved $ref "${ref}"; treated as any.`,
      });
      return {};
    }
    return derefSchema(
      defs[name],
      defs,
      new Set([...seen, name]),
      depth + 1,
      warnings,
    );
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(n)) {
    if (k === "$defs" || k === "definitions") continue; // resolved away
    if (
      SCHEMA_MAP_KEYWORDS.has(k) &&
      v &&
      typeof v === "object" &&
      !Array.isArray(v)
    ) {
      const props: Record<string, unknown> = {};
      for (const [pk, pv] of Object.entries(v as Record<string, unknown>)) {
        props[pk] = derefSchema(pv, defs, seen, depth + 1, warnings);
      }
      out[k] = props;
    } else if (SCHEMA_KEYWORDS.has(k) && v && typeof v === "object") {
      out[k] = derefSchema(v, defs, seen, depth + 1, warnings);
    } else if (SCHEMA_LIST_KEYWORDS.has(k) && Array.isArray(v)) {
      out[k] = v.map((s) => derefSchema(s, defs, seen, depth + 1, warnings));
    } else {
      out[k] = v;
    }
  }
  return out;
}

// Parse a JSON Schema document string into a config's own `SchemaField[]`. Each
// top-level property becomes a field (its raw sub-schema, collapsed by
// `normalizeField` when it maps to a simple type); the `required` array drives
// each field's required flag. Inverse of `fieldsToJsonSchema` for the shapes the
// editor round-trips.
export function jsonSchemaStringToFields(text: string): SchemaConversionResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text || "{}");
  } catch {
    return { fields: [], error: "Invalid JSON", warnings: [] };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { fields: [], error: "Schema must be a JSON object", warnings: [] };
  }
  const obj = parsed as Record<string, unknown>;
  // Inline local `$ref`s against the root `$defs`/`definitions` (and resolve a
  // root-level `$ref`) so each field's stored sub-schema is self-contained.
  const warnings: SchemaWarning[] = [];
  const asObj = (v: unknown): Record<string, unknown> =>
    v && typeof v === "object" && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : {};
  // Merge both keywords (a schema may use either; `$defs` wins on collision).
  const defs = { ...asObj(obj.definitions), ...asObj(obj.$defs) };
  const root = derefSchema(obj, defs, new Set(), 0, warnings) as Record<
    string,
    unknown
  >;

  // Root `additionalProperties` as a boolean is the family's extensibility
  // ("Allow extra fields") — nothing to import, nothing lost, no warning. A
  // TYPED root `additionalProperties` (a schema object) constrains extra
  // property values, which the per-field model can't represent — warn.
  const rootAp = root.additionalProperties;
  if (
    rootAp &&
    typeof rootAp === "object" &&
    !Array.isArray(rootAp) &&
    Object.keys(rootAp).length > 0
  ) {
    warnings.push({
      code: "unsupported-member",
      path: "additionalProperties",
      message:
        'A typed root "additionalProperties" schema is not supported; the value constraint on extra properties was dropped.',
    });
  }

  const props = root.properties;
  if (props === undefined) return { fields: [], error: null, warnings };
  if (!props || typeof props !== "object" || Array.isArray(props)) {
    return {
      fields: [],
      error: '"properties" must be an object',
      warnings,
    };
  }
  const required = Array.isArray(root.required)
    ? (root.required.filter((r) => typeof r === "string") as string[])
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
  return { fields, error: null, warnings };
}

// An empty (but valid) object schema, honoring family extensibility.
function emptyJsonSchema(additionalProperties: boolean): string {
  return JSON.stringify(
    { type: "object", properties: {}, additionalProperties },
    null,
    2,
  );
}

// Serialize fields back to a pretty-printed JSON Schema document. Degrades to an
// empty object schema when there are no fields (`simpleToJSONSchema` requires at
// least one), so export never throws.
export function fieldsToJsonSchema(
  fields: SchemaField[],
  opts?: FromFieldsOptions,
): string {
  const additionalProperties = opts?.additionalProperties ?? false;
  if (!fields.length) return emptyJsonSchema(additionalProperties);
  try {
    return JSON.stringify(
      JSON.parse(
        simpleToJSONSchema({
          type: opts?.type ?? "object",
          fields,
          additionalProperties,
        }),
      ),
      null,
      2,
    );
  } catch {
    return emptyJsonSchema(additionalProperties);
  }
}

// JSON Schema converter — the canonical/default schema surface.
export const jsonSchemaConverter: SchemaConverter = {
  id: "json-schema",
  label: "JSON Schema",
  toFields: jsonSchemaStringToFields,
  fromFields: fieldsToJsonSchema,
};
