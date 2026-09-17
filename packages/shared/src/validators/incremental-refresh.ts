import { z } from "zod";
import { baseSchema } from "./base-model";

// Identity for each metric a cache materializes. Which side(s) of the metric
// this cache actually holds (numerator, denominator, or both) is derivable
// from the metric's column refs and the source's `factTableId`, so we don't
// persist it here — see `getMetricSourceTableSchema` for the canonical rule.
export const incrementalRefreshMetricSourceValidator = z.object({
  groupId: z.string(),
  factTableId: z.string(),
  metrics: z.array(
    z.object({
      id: z.string(),
      settingsHash: z.string(),
    }),
  ),
  maxTimestamp: z.date().nullable(),
  // Same instant at the warehouse's own precision (see rawWatermark);
  // absent on documents written before it was captured.
  maxTimestampRaw: z.string().nullable().optional(),
  tableFullName: z.string(),
});

export const incrementalRefreshMetricCovariateSourceValidator = z.object({
  groupId: z.string(),
  tableFullName: z.string(),
  lastSuccessfulMaxTimestamp: z.date().nullable(),
  lastSuccessfulMaxTimestampRaw: z.string().nullable().optional(),
});

const incrementalRefresh = z
  .object({
    // Refs
    experimentId: z.string(),
    // Legacy documents gain a phase when they next refresh.
    phase: z.number().optional(),

    // Unit Source Settings
    unitsTableFullName: z.string().nullable(),
    unitsMaxTimestamp: z.date().nullable(),
    unitsMaxTimestampRaw: z.string().nullable().optional(),
    unitsDimensions: z.array(z.string()),

    // Experiment Settings Hash
    experimentSettingsHash: z.string().nullable(),

    // Snapshot whose run materialized the current tables
    materializedBySnapshotId: z.string().optional(),

    // Metrics
    metricSources: z.array(incrementalRefreshMetricSourceValidator),

    metricCovariateSources: z.array(
      incrementalRefreshMetricCovariateSourceValidator,
    ),

    // Incremental refresh lock
    currentExecutionSnapshotId: z.string().nullable(),
    lockHeartbeatAt: z.date().nullable().optional(),
  })
  .strict();

export const incrementalRefreshValidator = baseSchema
  .extend(incrementalRefresh.shape)
  .strict();

export type IncrementalRefreshInterface = z.infer<
  typeof incrementalRefreshValidator
>;

export type IncrementalRefreshMetricSourceInterface = z.infer<
  typeof incrementalRefreshMetricSourceValidator
>;

export type IncrementalRefreshMetricCovariateSourceInterface = z.infer<
  typeof incrementalRefreshMetricCovariateSourceValidator
>;
