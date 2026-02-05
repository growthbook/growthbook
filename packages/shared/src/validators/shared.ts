import { z } from "zod";

// Legacy format (single range, inherits experiment's hashAttribute)
const legacyNamespaceValue = z.object({
  enabled: z.boolean(),
  name: z.string(),
  range: z.tuple([z.number(), z.number()]),
});

// MultiRange format (multiple ranges, own hashAttribute, and hashVersion)
// Note: hashVersion defaults to 2 if not provided in application logic
const multiRangeNamespaceValue = z.object({
  enabled: z.boolean(),
  name: z.string(),
  ranges: z.array(z.tuple([z.number(), z.number()])),
  hashAttribute: z.string().optional(), // If not provided, inherits from experiment
  hashVersion: z.number().optional(), // Defaults to 2 in application logic
});

// Union type to support both formats for backward compatibility
export const namespaceValue = z.union([
  legacyNamespaceValue,
  multiRangeNamespaceValue,
]);
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
