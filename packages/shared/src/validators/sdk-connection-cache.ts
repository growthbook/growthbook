import { z } from "zod";
import { baseSchema } from "./base-model";

export const sdkConnectionCacheAuditContextValidator = z.object({
  dateUpdated: z.date(),
  event: z.string(),
  model: z.string(),
  id: z.string().optional(),
  stack: z.string(),
  connection: z.record(z.string(), z.unknown()),
});

export const sdkConnectionCacheValidator = baseSchema.extend({
  contents: z.string(),
  schemaVersion: z.number(),
  audit: sdkConnectionCacheAuditContextValidator.optional(),
});

export type SdkConnectionCacheAuditContext = z.infer<
  typeof sdkConnectionCacheAuditContextValidator
>;
export type SdkConnectionCacheInterface = z.infer<
  typeof sdkConnectionCacheValidator
>;
