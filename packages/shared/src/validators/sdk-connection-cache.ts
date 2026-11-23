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

const autoExperimentFeature = z.enum([
  "visualEditor",
  "urlRedirects",
  "customJs",
  "crossOriginRedirects",
]);

// What the payload holds that an organization can turn off, and what was left
// out because it was off. A cached payload that disagrees with the current
// settings is rebuilt before it is served.
export const sdkConnectionCacheAutoExperimentUseValidator = z.object({
  served: z.array(autoExperimentFeature),
  withheld: z.array(autoExperimentFeature),
});

export const sdkConnectionCacheValidator = baseSchema.extend({
  contents: z.string(),
  schemaVersion: z.number(),
  autoExperimentUse: sdkConnectionCacheAutoExperimentUseValidator.optional(),
  audit: sdkConnectionCacheAuditContextValidator.optional(),
});

export type SdkConnectionCacheAuditContext = z.infer<
  typeof sdkConnectionCacheAuditContextValidator
>;
export type SdkConnectionCacheAutoExperimentUse = z.infer<
  typeof sdkConnectionCacheAutoExperimentUseValidator
>;
export type SdkConnectionCacheInterface = z.infer<
  typeof sdkConnectionCacheValidator
>;
