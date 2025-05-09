import { z } from "zod";
import { baseSchema } from "back-end/src/models/BaseModel";

export const globalHoldoutStatusArray = ["running", "stopped"] as const;

export type GlobalHoldoutStatus = typeof globalHoldoutStatusArray[number];

const globalHoldout = z.object({
  startedAt: z.date().optional(),
  linkedFeatures: z.array(z.string()),
  linkedExperiments: z.array(z.string()),
  description: z.string().optional(),
  experimentId: z.string(),
});

export const globalHoldoutValidator = baseSchema
  .extend(globalHoldout.shape)
  .strict();

export type GlobalHoldoutInterface = z.infer<typeof globalHoldoutValidator>;
