import { z } from "zod";
import { baseSchema } from "./base-model";

// Which side(s) of a metric's per-user aggregates this source's cache table
// materializes. For same-fact-table metrics (including same-FT ratios) this is
// always "complete". Cross-fact-table ratio metrics appear in two metric sources:
// the numerator FT source with role "numerator" and the denominator FT source
// with role "denominator". Default to "complete" when absent.
export const incrementalRefreshMetricRoleValidator = z.enum([
  "complete",
  "numerator",
  "denominator",
]);

export const incrementalRefreshMetricSourceValidator = z.object({
  groupId: z.string(),
  factTableId: z.string(),
  metrics: z.array(
    z.object({
      id: z.string(),
      settingsHash: z.string(),
      role: incrementalRefreshMetricRoleValidator.optional(),
    }),
  ),
  maxTimestamp: z.date().nullable(),
  tableFullName: z.string(),
});

export const incrementalRefreshMetricCovariateSourceValidator = z.object({
  groupId: z.string(),
  tableFullName: z.string(),
  lastSuccessfulMaxTimestamp: z.date().nullable(),
});

// Bumped whenever the shape of `metricSources` changes in a backwards-
// incompatible way. Any persisted record with a lower version is treated as
// stale and triggers a one-shot full rebuild on the next run.
//
// History:
//   1 – original PR shape: cross-FT ratio metrics had their own dedicated
//       source group with denominatorFactTableId / denominatorMaxTimestamp.
//   2 – current shape: cross-FT ratio metrics fan into both the numerator-FT
//       source (role "numerator") and denominator-FT source (role "denominator"),
//       no dedicated group. Old records with version < 2 (or absent) are rebuilt.
export const INCREMENTAL_REFRESH_METRIC_SOURCES_VERSION = 2;

const incrementalRefresh = z
  .object({
    // Refs
    experimentId: z.string(),

    // Unit Source Settings
    unitsTableFullName: z.string().nullable(),
    unitsMaxTimestamp: z.date().nullable(),
    unitsDimensions: z.array(z.string()),

    // Experiment Settings Hash
    experimentSettingsHash: z.string().nullable(),

    // Metrics
    metricSources: z.array(incrementalRefreshMetricSourceValidator),

    metricCovariateSources: z.array(
      incrementalRefreshMetricCovariateSourceValidator,
    ),

    // Version stamp for metricSources shape; missing = pre-versioning (v1).
    // When the current code bumps this, stale records trigger a full rebuild.
    metricSourcesVersion: z.number().optional(),

    // Incremental refresh lock
    currentExecutionSnapshotId: z.string().nullable(),
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

export type IncrementalRefreshMetricRole = z.infer<
  typeof incrementalRefreshMetricRoleValidator
>;

export type IncrementalRefreshMetricCovariateSourceInterface = z.infer<
  typeof incrementalRefreshMetricCovariateSourceValidator
>;
