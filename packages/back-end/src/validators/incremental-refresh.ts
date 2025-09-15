import { z } from "zod";
import { baseSchema } from "back-end/src/models/BaseModel";

const incrementalRefresh = z
  .object({
    // Refs
    experimentId: z.string(),

    // Settings
    unitsTableFullName: z.string(),
    lastScannedTimestamp: z.date(),

    // Metrics
    metricSources: z.array(
      z.object({
        groupId: z.string(),
        metricIds: z.array(z.string()),
        maxTimestamp: z.date(),
        tableFullName: z.string(),
      })
    ),
  })
  .strict();

export const incrementalRefreshValidator = baseSchema
  .extend(incrementalRefresh.shape)
  .strict();

export type IncrementalRefreshInterface = z.infer<
  typeof incrementalRefreshValidator
>;
