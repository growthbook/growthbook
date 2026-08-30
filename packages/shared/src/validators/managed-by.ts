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
