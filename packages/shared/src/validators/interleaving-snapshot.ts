import { z } from "zod";
import { baseSchema } from "./base-model";
import {
  interleavingAnalysisValidator,
  interleavingMetricConfigValidator,
  interleavingVariationValidator,
} from "./interleaving";
import { namedSchema } from "./openapi-helpers";
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
// or per exposed user (preference analyses).
const interleavingResultSideValidator = z
  .object({ value: z.number(), cr: z.number() })
  .strict();

// Treatment vs control, as returned by stats-ts (pairedDeltaTest or
// preferenceSignTest). `ci` bounds are null when unbounded.
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
    // What each side's `cr` divides `value` by: competitive treatment-drafted
    // exposures in engaged impressions (paired) or exposed users (preference)
    denominator: z.number().optional(),
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
          exposureQuery: true,
          startDate: true,
          endDate: true,
        })
        .extend({
          startDate: z.iso.datetime(),
          endDate: z.iso.datetime().nullable(),
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
