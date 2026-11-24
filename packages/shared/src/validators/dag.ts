import { z } from "zod";
import { baseSchema } from "./base-model";

export const dagNodeValidator = z
  .object({
    id: z.string(),
    dependsOn: z.array(z.string()),
    // What targetId refers to
    type: z.enum(["experiment-snapshot"]),
    // The current attempt
    targetId: z.string(),
    // Earlier failed attempts
    previousTargetIds: z.array(z.string()),
    maxAttempts: z.number().int().min(1),
  })
  .strict();

export const dagValidator = baseSchema
  .extend({
    status: z.enum(["active", "done"]),
    nodes: z.array(dagNodeValidator),
  })
  .strict();

export type DagNode = z.infer<typeof dagNodeValidator>;
export type DagInterface = z.infer<typeof dagValidator>;
