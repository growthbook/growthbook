import { z } from "zod";
import { baseSchema } from "./base-model";
import { queryPointerValidator } from "./queries";

// Which estimator analyzed a metric:
// - "paired": engagement joinable to impressions via interleave_id ->
//   DoorDash-style paired delta-method t-test
// - "ownership": no interleave_id -> Airbnb-style per-user item-ownership
//   attribution + sign test
export const interleavingEstimators = ["paired", "ownership"] as const;
export type InterleavingEstimator = (typeof interleavingEstimators)[number];

// Per-metric analysis config. "paired" is only allowed when the metric's
// fact table has both item_id and interleave_id columns; "ownership" only
// requires item_id.
export const interleavingMetricConfigValidator = z
  .object({
    id: z.string(),
    estimator: z.enum(interleavingEstimators),
  })
  .strict();
export type InterleavingMetricConfig = z.infer<
  typeof interleavingMetricConfigValidator
>;

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
    interleaving: z.string(),
    status: z.enum(["pending", "running", "success", "error"]),
    error: z.string().optional(),
    runStarted: z.date().nullable(),
    queries: z.array(queryPointerValidator),
    frozenSettings: interleavingSnapshotSettingsValidator.optional(),
    // Which estimator analyzed each metric (decided at snapshot time)
    metricEstimators: z
      .record(z.string(), z.enum(interleavingEstimators))
      .optional(),
    // ExperimentReportResultDimension[]-shaped (typed loosely for Mongo
    // storage; the runner produces and the front-end consumes the real type)
    results: z.array(z.unknown()).optional(),
  })
  .strict();

export type InterleavingSnapshotInterface = z.infer<
  typeof interleavingSnapshotValidator
>;
