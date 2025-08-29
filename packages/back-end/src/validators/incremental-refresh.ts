import { z } from "zod";
import { baseSchema } from "back-end/src/models/BaseModel";

const incrementalRefresh = z
  .object({
    // Refs
    experimentId: z.string(),

    // Settings
    unitsTableFullName: z.string(),
    lastScannedTimestamp: z.date(),
  })
  .strict();

export const incrementalRefreshValidator = baseSchema
  .extend(incrementalRefresh.shape)
  .strict();

export type IncrementalRefreshInterface = z.infer<
  typeof incrementalRefreshValidator
>;
