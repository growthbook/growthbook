import { z } from "zod";

/**
 * Zod 4's z.number() rejects Infinity/-Infinity. This helper accepts all
 * finite numbers plus ±Infinity, which is needed for stats-engine fields
 * (e.g. one-sided confidence intervals).
 */
export const numberAllowingInfinity = z
  .number()
  .or(z.literal(Infinity))
  .or(z.literal(-Infinity));

export const ciTupleValidator = z.tuple([
  numberAllowingInfinity,
  numberAllowingInfinity,
]);

export const namespaceValue = z
  .object({
    enabled: z.boolean(),
    name: z.string(),
    range: z.tuple([z.number(), z.number()]),
  })
  .strict();
export type NamespaceValue = z.infer<typeof namespaceValue>;

export const featurePrerequisite = z
  .object({
    id: z.string(),
    condition: z.string(),
  })
  .strict();
export type FeaturePrerequisite = z.infer<typeof featurePrerequisite>;

export const savedGroupTargeting = z
  .object({
    match: z.enum(["all", "none", "any"]),
    ids: z.array(z.string()),
  })
  .strict();
export type SavedGroupTargeting = z.infer<typeof savedGroupTargeting>;
