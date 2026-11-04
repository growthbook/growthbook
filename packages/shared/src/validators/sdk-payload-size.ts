import { z } from "zod";
import { SDK_OPTIONAL_PAYLOAD_SETTINGS } from "shared/constants";

export const sdkPayloadSizeLevelValidator = z.enum([
  "ok",
  "warning",
  "danger",
  "over-limit",
]);

const sdkPayloadSizeEntryValidator = z.object({
  id: z.string(),
  bytes: z.number(),
});

export const sdkPayloadSizeBreakdownValidator = z.object({
  measuredAt: z.date(),
  // The payload's total size when this was measured
  bytes: z.number(),
  // Bytes per top-level payload key (features, savedGroups, experiments, ...)
  sections: z.record(z.string(), z.number()),
  // Empty when that section is encrypted
  largestFeatures: z.array(sdkPayloadSizeEntryValidator),
  largestSavedGroups: z.array(sdkPayloadSizeEntryValidator),
});

export const sdkPayloadSizeValidator = z.object({
  bytes: z.number(),
  // The largest document the cache's database accepts when this was measured
  limitBytes: z.number(),
  measuredAt: z.date(),
  // Only measured once the payload is large enough to warn about
  breakdown: sdkPayloadSizeBreakdownValidator.nullable(),
});

export const sdkPayloadSizeRecommendationValidator = z.discriminatedUnion(
  "type",
  [
    z.object({ type: z.literal("saved-group-references") }),
    z.object({ type: z.literal("limit-projects") }),
    z.object({ type: z.literal("archive-stale-features") }),
    z.object({
      type: z.literal("large-features"),
      entries: z.array(sdkPayloadSizeEntryValidator),
    }),
    z.object({
      type: z.literal("large-saved-groups"),
      entries: z.array(sdkPayloadSizeEntryValidator),
    }),
    z.object({
      type: z.literal("optional-payload-settings"),
      settings: z.array(z.enum(SDK_OPTIONAL_PAYLOAD_SETTINGS)),
    }),
  ],
);

// An SDK Connection whose payload is large enough to warn about org-wide
export const sdkPayloadSizeAlertValidator = z.object({
  connectionId: z.string(),
  connectionName: z.string(),
  level: sdkPayloadSizeLevelValidator,
  bytes: z.number(),
  limitBytes: z.number(),
  // Names only Feature Flags and Saved Groups the viewer can read
  recommendations: z.array(sdkPayloadSizeRecommendationValidator),
});

export type SdkPayloadSizeAlert = z.infer<typeof sdkPayloadSizeAlertValidator>;
export type SdkPayloadSizeLevel = z.infer<typeof sdkPayloadSizeLevelValidator>;
export type SdkPayloadSizeBreakdown = z.infer<
  typeof sdkPayloadSizeBreakdownValidator
>;
export type SdkPayloadSize = z.infer<typeof sdkPayloadSizeValidator>;
export type SdkPayloadSizeRecommendation = z.infer<
  typeof sdkPayloadSizeRecommendationValidator
>;
export type OptionalPayloadSetting =
  (typeof SDK_OPTIONAL_PAYLOAD_SETTINGS)[number];
