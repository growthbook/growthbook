import { z } from "zod";

/**
 * Registry of all named schemas — used by generate-openapi.ts to ensure
 * every named schema appears in components/schemas even if it's never
 * referenced as a sub-schema of a response body.
 */
export const namedSchemaRegistry: Map<string, z.ZodType> = new Map();

/**
 * Mark a Zod schema as a named OpenAPI component schema.
 * When `z.toJSONSchema` encounters a schema with `.meta({ id })`,
 * it emits it as a `$defs` entry with a `$ref` pointer.
 * The `generate-openapi.ts` script hoists these into
 * `components/schemas/` and generates `_model` doc tags.
 */
export function namedSchema<T extends z.ZodType>(name: string, schema: T): T {
  if (!process.env.ENABLE_ZOD_SCHEMA_REGISTRATION) {
    return schema;
  }
  const tagged = schema.meta({ id: name }) as T;
  namedSchemaRegistry.set(name, tagged);
  return tagged;
}
