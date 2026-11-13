import { z } from "zod";

export const postIdentifierValidator = z.strictObject({
  property: z.string().min(1, "Attribute property cannot be empty"),
  datatype: z.enum(["string", "number", "secureString"]),
  format: z.enum(["", "version", "date", "isoCountryCode"]).optional(),
  disableEqualityConditions: z.boolean().optional(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  customFields: z.record(z.string(), z.string()).optional(),
  projects: z.array(z.string()),
  datasources: z.array(
    z.strictObject({ id: z.string(), userIdType: z.string() }),
  ),
});
export type PostIdentifierBody = z.infer<typeof postIdentifierValidator>;
export type IdentifierLink = PostIdentifierBody["datasources"][number];

export const putIdentifierValidator = postIdentifierValidator.extend({
  previousName: z.string().optional(),
});
export type PutIdentifierBody = z.infer<typeof putIdentifierValidator>;
