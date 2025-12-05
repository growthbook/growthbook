import { z } from "zod";
import { baseSchema } from "shared/validators";

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
  tableFullName: z.string(),
});

export const incrementalRefreshMetricCovariateSourceValidator = z.object({
  groupId: z.string(),
  tableFullName: z.string(),
  lastSuccessfulMaxTimestamp: z.date().nullable(),
});

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
