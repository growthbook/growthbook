import { z } from "zod";
import { baseSchema } from "./base-model";

// One week's Health score for a scope, kept for the score trend
export const insightsHealthScoreValidator = baseSchema
  .extend({
    // "" is All Projects
    project: z.string(),
    weekStart: z.date(),
    score: z.number().nullable(),
    quality: z.number().nullable(),
    healthyRate: z.number().nullable(),
    completed: z.number(),
  })
  .strict();
export type InsightsHealthScoreInterface = z.infer<
  typeof insightsHealthScoreValidator
>;
