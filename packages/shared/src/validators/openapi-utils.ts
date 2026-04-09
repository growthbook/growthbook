import { ZodType } from "zod";

/**
 * Tags a schema with a name so the generate-openapi script promotes it to
 * `components/schemas` instead of inlining it at every use site. Wherever
 * this schema appears nested inside another schema, `toJSONSchema` will emit
 * a `$ref` pointer to it automatically.
 *
 * Use this for any schema that represents a meaningful, reusable API type.
 */
export function namedSchema<T extends ZodType>(name: string, schema: T): T {
  return schema.meta({ id: name }) as T;
}
