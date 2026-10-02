import { z } from "zod";

// Built-in pre-launch checklist items an org or project checklist can hide
export const builtInChecklistItemKeyValidator = z.enum([
  "datasource",
  "exposureQuery",
  "goalMetric",
  "linkedChanges",
  "targeting",
  "sdkConnection",
]);

export type BuiltInChecklistItemKey = z.infer<
  typeof builtInChecklistItemKeyValidator
>;
