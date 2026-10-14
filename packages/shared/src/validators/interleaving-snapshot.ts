import { z } from "zod";
import { baseSchema } from "./base-model";
import {
  interleavingAnalysisValidator,
  interleavingMetricConfigValidator,
  interleavingVariationValidator,
} from "./interleaving";
import { queryPointerValidator } from "./queries";

/**
 * Frozen, self-contained settings for a single interleaving snapshot run,
 * copied from the parent Interleaving and its Interleaving Exposure Query
 * (contextual-bandit-snapshot pattern: `.strict()` and feature-specific).
 */
export const interleavingSnapshotSettingsValidator = z
  .object({
    interleavingId: z.string(),
    trackingKey: z.string(),
    datasourceId: z.string(),
    interleavingExposureQueryId: z.string(),
    exposureQuery: z.string(),
    userIdType: z.string(),
    // Control first. `key` is matched against the exposure items' `variation`;
    // `name` is what results display.
    variations: z.tuple([
      interleavingVariationValidator.pick({ id: true, key: true, name: true }),
      interleavingVariationValidator.pick({ id: true, key: true, name: true }),
    ]),
    metrics: z.array(interleavingMetricConfigValidator),
    startDate: z.date(),
    endDate: z.date().nullable(),
  })
  .strict();

export type InterleavingSnapshotSettings = z.infer<
  typeof interleavingSnapshotSettingsValidator
>;

// One ranker's side of a result. `cr` is the value per treatment-drafted
// competitive exposure in engaged impressions (paired analysis; both sides
// share that denominator, which a fair team draft balances in expectation)
// or per exposed user (ownership analyses).
const interleavingResultSideValidator = z
  .object({ value: z.number(), cr: z.number() })
  .strict();

// Treatment vs control, as returned by stats-ts (pairedDeltaTest or
// ownershipSignTest). `ci` bounds are null when unbounded.
const interleavingTestResultValidator = z
  .object({
    expected: z.number(),
    ci: z.tuple([z.number().nullable(), z.number().nullable()]),
    uplift: z
      .object({ dist: z.string(), mean: z.number(), stddev: z.number() })
      .strict(),
    pValue: z.number().nullable(),
    errorMessage: z.string().nullable(),
    pValueErrorMessage: z.string().nullable(),
  })
  .strict();

/** Result of one (metric, analysis) pair. */
export const interleavingMetricResultValidator = z
  .object({
    metricId: z.string(),
    analysis: interleavingAnalysisValidator,
    // Users the analysis is over: engaged users (paired) or exposed users
    users: z.number(),
    control: interleavingResultSideValidator,
    treatment: interleavingResultSideValidator,
    test: interleavingTestResultValidator,
  })
  .strict();
export type InterleavingMetricResult = z.infer<
  typeof interleavingMetricResultValidator
>;

export const interleavingSnapshotValidator = baseSchema
  .extend({
    interleavingId: z.string(),
    // Frozen from the parent so snapshot permissions don't need a parent load
    project: z.string().optional(),
    status: z.enum(["pending", "running", "success", "error"]),
    error: z.string().optional(),
    runStarted: z.date().nullable(),
    queries: z.array(queryPointerValidator),
    frozenSettings: interleavingSnapshotSettingsValidator,
    results: z.array(interleavingMetricResultValidator).optional(),
  })
  .strict();

export type InterleavingSnapshotInterface = z.infer<
  typeof interleavingSnapshotValidator
>;
