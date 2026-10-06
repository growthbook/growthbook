import { z } from "zod";
import { baseSchema } from "./base-model";
import { queryPointerValidator } from "./queries";

// Per-metric analysis config. "paired" is only allowed when the metric's
// fact table has both item_id and interleave_id columns; the ownership types
// only require item_id.
export const interleavingMetricConfigValidator = z.discriminatedUnion(
  "attributionType",
  [
    z
      .object({
        id: z.string(),
        attributionType: z.literal("paired"),
      })
      .strict(),
    z
      .object({
        id: z.string(),
        attributionType: z.literal("ownershipByExposureCount"),
      })
      .strict(),
    // z
    //   .object({
    //     id: z.string(),
    //     attributionType: z.literal("ownershipByEventCount"),
    //     // Metric whose event counts determine ownership
    //     ownershipMetricId: z.string(),
    //   })
    //   .strict(),
  ],
);
export type InterleavingMetricConfig = z.infer<
  typeof interleavingMetricConfigValidator
>;
export type AttributionType = InterleavingMetricConfig["attributionType"];

/**
 * Frozen, self-contained settings for a single interleaving snapshot run
 * (contextual-bandit-snapshot pattern: `.strict()` and feature-specific).
 */
export const interleavingSnapshotSettingsValidator = z
  .object({
    interleavingId: z.string(),
    trackingKey: z.string(),
    datasourceId: z.string(),
    interleavingQueryId: z.string(),
    query: z.string(),
    userIdType: z.string(),
    variationNames: z.tuple([z.string(), z.string()]),
    metrics: z.array(interleavingMetricConfigValidator),
    startDate: z.date(),
    endDate: z.date().nullable().optional(),
  })
  .strict();

export type InterleavingSnapshotSettings = z.infer<
  typeof interleavingSnapshotSettingsValidator
>;

export const interleavingSnapshotValidator = baseSchema
  .extend({
    interleavingId: z.string(),
    status: z.enum(["pending", "running", "success", "error"]),
    error: z.string().optional(),
    runStarted: z.date().nullable(),
    queries: z.array(queryPointerValidator),
    frozenSettings: interleavingSnapshotSettingsValidator.optional(),
    // results typed loosely for Mongo storage;
    // the runner produces and the front-end consumes the real type
    results: z.array(z.unknown()).optional(),
  })
  .strict();

export type InterleavingSnapshotInterface = z.infer<
  typeof interleavingSnapshotValidator
>;
