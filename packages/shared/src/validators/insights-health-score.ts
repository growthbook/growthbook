import { z } from "zod";
import { baseSchema } from "./base-model";

// The All Projects row; "" is the No Project scope
export const HEALTH_SCORE_ALL_PROJECTS = "__all__";

// One week's Health score for a scope, kept for the score trend
export const insightsHealthScoreValidator = baseSchema
  .extend({
    // A Project id, "" for No Project, or HEALTH_SCORE_ALL_PROJECTS. Not
    // named `project`, which BaseModel requires to be a real Project.
    scope: z.string(),
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
