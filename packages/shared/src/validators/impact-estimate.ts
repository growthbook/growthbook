import { z } from "zod";
import { baseSchema } from "./base-model";

export const queryLanguageValidator = z.enum([
  "sql",
  "javascript",
  "json",
  "none",
]);

export const impactEstimateValidator = baseSchema.safeExtend({
  metric: z.string(),
  segment: z.string().optional(),
  conversionsPerDay: z.number(),
  query: z.string(),
  queryLanguage: queryLanguageValidator,
});
