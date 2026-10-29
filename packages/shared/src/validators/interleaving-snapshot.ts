import { z } from "zod";
import type { InterleavingTestResult } from "../../types/stats-engine";
import { baseSchema } from "./base-model";
import {
  interleavingAnalysisValidator,
  interleavingMetricConfigValidator,
  interleavingRunValidator,
  interleavingVariationValidator,
} from "./interleaving";
import { namedSchema } from "./openapi-helpers";
import { queryPointerValidator } from "./queries";

/**
 * Self-contained settings for a single interleaving snapshot run, copied from
 * the parent Interleaving and its Interleaving Exposure Query when the
 * snapshot is created so later edits cannot reinterpret an existing result.
 */
export const interleavingSnapshotSettingsValidator = z
  .object({
    interleavingId: z.string(),
    trackingKey: z.string(),
    datasourceId: z.string(),
    interleavingExposureQueryId: z.string(),
    interleavingExposureQuerySql: z.string(),
    userIdType: z.string(),
    // Control first. `key` is matched against the exposure items' `variation`;
    // `name` is what results display.
    variations: z.tuple([
      interleavingVariationValidator.pick({ id: true, key: true, name: true }),
      interleavingVariationValidator.pick({ id: true, key: true, name: true }),
    ]),
    metrics: z.array(interleavingMetricConfigValidator),
    // Frozen so a later org-settings change cannot reinterpret this result.
    // Drives the test alpha, and the results table colours significance by
    // the same number.
    pValueThreshold: z.number(),
    runs: z.array(interleavingRunValidator.required({ dateEnded: true })),
    startDate: z.date(),
    endDate: z.date(),
  })
  .strict();

export type InterleavingSnapshotSettings = z.infer<
  typeof interleavingSnapshotSettingsValidator
>;

// One ranker's side of a result. `cr` is the value per treatment-drafted
// competitive exposure in engaged impressions (paired analysis; both sides
// share that denominator, which a fair team draft balances in expectation)
// or per non-tied user (preference analyses).
const interleavingResultSideValidator = z
  .object({ value: z.number(), cr: z.number() })
  .strict();

// Treatment vs control, as returned by stats-ts (pairedDeltaTest or
// preferenceSignTest). The `satisfies` is the point: it fails to compile if
// this drifts from the engine's InterleavingTestResult.
const interleavingTestResultValidator = z
  .object({
    method: z
      .enum(["paired_delta_t", "exact_binomial_sign"])
      .describe(
        "Which test produced this result. paired_delta_t: paired delta-method t-test on per-user credited rates (paired analysis). exact_binomial_sign: exact binomial sign test over non-tied users with a Clopper-Pearson interval (preference analysis).",
      ),
    expected: z.number(),
    ci: z.tuple([z.number().nullable(), z.number().nullable()]),
    pValue: z.number().nullable(),
    errorMessage: z.string().nullable(),
    pValueErrorMessage: z
      .enum([
        "NUMERICAL_PVALUE_NOT_CONVERGED",
        "ALPHA_GREATER_THAN_0.5_FOR_SEQUENTIAL_ONE_SIDED_TEST",
      ])
      .nullable(),
  })
  .strict() satisfies z.ZodType<InterleavingTestResult>;

/** Result of one (metric, analysis) pair. */
export const interleavingMetricResultValidator = z
  .object({
    metricId: z.string(),
    analysis: interleavingAnalysisValidator,
    // Users represented: engaged users (paired) or exposed users (preference)
    users: z.number(),
    // What each side's `cr` divides `value` by: competitive treatment-drafted
    // exposures in engaged impressions (paired) or non-tied users (preference)
    denominator: z.number(),
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
    status: z.enum(["running", "success", "error"]),
    error: z.string().optional(),
    runStarted: z.date().nullable(),
    queries: z.array(queryPointerValidator),
    settings: interleavingSnapshotSettingsValidator,
    results: z.array(interleavingMetricResultValidator).optional(),
  })
  .strict();

export type InterleavingSnapshotInterface = z.infer<
  typeof interleavingSnapshotValidator
>;

// REST API view of a snapshot (`/interleavings/:id/snapshots`). Lives here
// rather than in interleaving.ts because it embeds the results schema.
export const apiInterleavingSnapshotValidator = namedSchema(
  "InterleavingSnapshot",
  z
    .object({
      id: z.string(),
      interleavingId: z.string(),
      status: interleavingSnapshotValidator.shape.status,
      error: z.string().optional(),
      dateCreated: z.iso.datetime(),
      runStarted: z.iso.datetime().nullable(),
      // Analysis inputs frozen when the snapshot was created
      settings: interleavingSnapshotSettingsValidator
        .omit({
          interleavingId: true,
          interleavingExposureQuerySql: true,
          runs: true,
          startDate: true,
          endDate: true,
        })
        .extend({
          runs: z
            .array(
              z.strictObject({
                dateStarted: z.iso.datetime(),
                dateEnded: z.iso.datetime(),
              }),
            )
            .describe("The run windows these results count exposures from"),
          startDate: z.iso.datetime(),
          endDate: z.iso.datetime(),
        }),
      results: z
        .array(interleavingMetricResultValidator)
        .optional()
        .describe("Present once status is success"),
    })
    .strict(),
);

export type ApiInterleavingSnapshotInterface = z.infer<
  typeof apiInterleavingSnapshotValidator
>;

const interleavingIdParams = z.strictObject({
  id: z.string().describe("The interleaving experiment id"),
});

export const apiInterleavingRefreshValidator = {
  paramsSchema: interleavingIdParams,
  bodySchema: z.never(),
  querySchema: z.never(),
};

export const apiListInterleavingSnapshotsValidator = {
  paramsSchema: interleavingIdParams,
  bodySchema: z.never(),
  querySchema: z.strictObject({
    limit: z.coerce.number().int().positive().max(100).optional(),
  }),
};

export const apiGetInterleavingResultsValidator = {
  paramsSchema: interleavingIdParams,
  bodySchema: z.never(),
  querySchema: z.never(),
};

export const apiGetInterleavingSnapshotValidator = {
  paramsSchema: interleavingIdParams.extend({
    snapshotId: z.string().describe("The snapshot id"),
  }),
  bodySchema: z.never(),
  querySchema: z.never(),
};

export const apiInterleavingSnapshotReturn = z.object({
  snapshot: apiInterleavingSnapshotValidator,
});

export const apiInterleavingResultsReturn = z.object({
  snapshot: apiInterleavingSnapshotValidator
    .nullable()
    .describe("null until the first refresh"),
});

export const apiInterleavingSnapshotsReturn = z.object({
  snapshots: z.array(apiInterleavingSnapshotValidator),
});
