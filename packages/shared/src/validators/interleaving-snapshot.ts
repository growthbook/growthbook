import { z } from "zod";
import { baseSchema } from "./base-model";
import { queryPointerValidator } from "./queries";
import { interleavingEstimators } from "./interleaving";

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
    metricIds: z.array(z.string()),
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
