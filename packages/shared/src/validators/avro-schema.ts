import { z } from "zod";

export const avroFieldSourceEnum = z.enum([
  "top-level",
  "attributes",
  "properties",
]);

export type AvroFieldSource = z.infer<typeof avroFieldSourceEnum>;

export const avroFieldMappingValidator = z.object({
  name: z.string(),
  avroType: z.union([
    z.string(),
    z.array(z.union([z.string(), z.record(z.string(), z.unknown())])),
  ]),
  default: z.unknown().optional(),
  doc: z.string().optional(),
  source: avroFieldSourceEnum,
  sourcePath: z.string().optional(),
});

export type AvroFieldMappingInterface = z.infer<
  typeof avroFieldMappingValidator
>;

export const avroSchemaConfigValidator = z
  .object({
    id: z.string(),
    organization: z.string(),
    version: z.number(),
    fields: z.array(avroFieldMappingValidator),
    dateCreated: z.date(),
    dateUpdated: z.date(),
  })
  .strict();

export type AvroSchemaConfigInterface = z.infer<
  typeof avroSchemaConfigValidator
>;
