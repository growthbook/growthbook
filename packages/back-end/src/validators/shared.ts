import { z } from "zod";

export const savedGroupTargeting = z
  .object({
    match: z.enum(["all", "none", "any"]),
    ids: z.array(z.string()),
  })
  .strict();
export type SavedGroupTargeting = z.infer<typeof savedGroupTargeting>;

export const featurePrerequisite = z
  .object({
    id: z.string(),
    condition: z.string(),
  })
  .strict();
export type FeaturePrerequisite = z.infer<typeof featurePrerequisite>;

// Add namespaceValue validator
export const namespaceValue = z
  .object({
    enabled: z.boolean(),
    name: z.string(),
    range: z.tuple([z.number(), z.number()]),
  })
  .strict();
export type NamespaceValue = z.infer<typeof namespaceValue>;

export const safeRolloutStatus = [
  "running",
  "rolled-back",
  "released",
  "completed",
  "draft",
] as const;
export type SafeRolloutStatus = typeof safeRolloutStatus[number];
