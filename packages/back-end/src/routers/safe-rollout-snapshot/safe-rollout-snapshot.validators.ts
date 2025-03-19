import { z } from "zod";

export const createSafeRolloutSnapshotValidator = z.object({
  safeRolloutId: z.string(),
  featureId: z.string(),
});
