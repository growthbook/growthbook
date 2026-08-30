import { z } from "zod";

// All models default to an id for their primary key
export const defaultPrimaryKeyShape = { id: z.string() };

const baseSchemaCommon = {
  organization: z.string(),
  dateCreated: z.date(),
  dateUpdated: z.date(),
};

/** Inferred output of baseSchemaCommon - ensures z.infer flows for all base fields. */
type BaseSchemaCommonOutput = z.infer<z.ZodObject<typeof baseSchemaCommon>>;

export type BaseSchemaWithPrimaryKey<PKey extends z.ZodRawShape> = z.ZodObject<
  PKey & typeof baseSchemaCommon
> &
  z.ZodType<
    z.infer<z.ZodObject<PKey & typeof baseSchemaCommon>> &
      BaseSchemaCommonOutput
  >;

/**
 * Build a base schema with an optional primary key shape (default `id`).
 * Pass e.g. { userId: z.string(), organization: z.string() } for a composite key.
 */
export function createBaseSchemaWithPrimaryKey<PKey extends z.ZodRawShape>(
  primaryKey?: PKey,
): BaseSchemaWithPrimaryKey<PKey> {
  const key = primaryKey ?? defaultPrimaryKeyShape;
  return z.strictObject({
    ...key,
    ...baseSchemaCommon,
  }) as BaseSchemaWithPrimaryKey<PKey>;
}

export const baseSchema = createBaseSchemaWithPrimaryKey({ id: z.string() });

export const apiBaseSchema = z
  .object({
    id: z.string(),
    dateCreated: z.iso.datetime(),
    dateUpdated: z.iso.datetime(),
  })
  .strict();
