import { z } from "zod";
import { baseSchema } from "shared/src/validators/base-model";
import { eventUser } from "./events";

export const featureRevisionLog = z
  .object({
    featureId: z.string(),
    version: z.number(),
    user: eventUser,
    action: z.string(),
    subject: z.string(),
    value: z.string(),
  })
  .strict();

export const featureRevisionLogValidator = baseSchema
  .extend(featureRevisionLog.shape)
  .strict();

export type FeatureRevisionLogInterface = z.infer<
  typeof featureRevisionLogValidator
>;
