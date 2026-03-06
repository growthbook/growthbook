import { z } from "zod";
import { baseSchema } from "./base-model";

const experimentRefreshLock = z
  .object({
    experimentId: z.string(),
    snapshotId: z.string(),
    triggeredBy: z.enum(["manual", "schedule"]),
    lockedAt: z.date(),
    expiresAt: z.date(),
  })
  .strict();

export const experimentRefreshLockValidator = baseSchema
  .extend(experimentRefreshLock.shape)
  .strict();

export type ExperimentRefreshLockInterface = z.infer<
  typeof experimentRefreshLockValidator
>;
