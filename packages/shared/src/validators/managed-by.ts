import { z } from "zod";

const managedByVercelValidator = z
  .object({
    type: z.literal("vercel"),
    resourceId: z.string(),
  })
  .strict();

export const managedByValidator = z.discriminatedUnion("type", [
  managedByVercelValidator,
]);

export type ManagedBy = z.infer<typeof managedByValidator>;

const managedByExperimentValidator = z
  .object({
    type: z.literal("experiment"),
    experimentId: z.string(),
  })
  .strict();

// Kept apart from `managedByValidator`, the Vercel marker on resources an
// experiment can never own.
export const featureManagedByValidator = z.discriminatedUnion("type", [
  managedByExperimentValidator,
]);
