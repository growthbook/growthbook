import { z } from "zod";

export const createSafeRolloutSnapshotValidator = z.object({
  dimension: z.string().optional(),
  featureId: z.string(),
});
