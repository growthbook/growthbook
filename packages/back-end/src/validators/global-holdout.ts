import { z } from "zod";
import { baseSchema } from "back-end/src/models/BaseModel";

export const globalHoldoutStatusArray = ["running", "stopped"] as const;

export type GlobalHoldoutStatus = typeof globalHoldoutStatusArray[number];

const globalHoldout = z.object({
  key: z.string(),
  status: z.enum(globalHoldoutStatusArray),
  startedAt: z.date().optional(),
  linkedFeatures: z.array(z.string()),
  linkedExperiments: z.array(z.string()),
  description: z.string().optional(),
});

export const globalHoldoutValidator = baseSchema
  .extend(globalHoldout.shape)
  .strict();

export type GlobalHoldoutInterface = z.infer<typeof globalHoldoutValidator>;
