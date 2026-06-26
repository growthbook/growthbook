import { SchemaField } from "shared/types/feature";
import { simpleToJSONSchema } from "../features";
import { normalizeField } from "./fields";
import {
  FromFieldsOptions,
  SchemaConversionResult,
  SchemaConverter,
} from "./types";

// JSON Schema is the canonical pivot. This file holds both halves: import
// (document → fields) and export (fields → document, via `simpleToJSONSchema`).

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
  const props = obj.properties;
  if (props === undefined) return { fields: [], error: null, warnings: [] };
  if (!props || typeof props !== "object" || Array.isArray(props)) {
    return {
      fields: [],
      error: '"properties" must be an object',
      warnings: [],
    };
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
  return { fields, error: null, warnings: [] };
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
