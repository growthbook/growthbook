import { z } from "zod";
import { baseSchema } from "back-end/src/models/BaseModel";

export const incrementalRefreshMetricSourceValidator = z.object({
  groupId: z.string(),
  metrics: z.array(
    z.object({
      id: z.string(),
      settingsHash: z.string(),
    }),
  ),
  maxTimestamp: z.date().nullable(),
  tableFullName: z.string(),
});

const incrementalRefresh = z
  .object({
    // Refs
    experimentId: z.string(),

    // Unit Source Settings
    unitsTableFullName: z.string().nullable(),
    unitsMaxTimestamp: z.date().nullable(),

    // Experiment Settings Hash
    experimentSettingsHash: z.string().nullable(),

    // Metrics
    metricSources: z.array(incrementalRefreshMetricSourceValidator),
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
