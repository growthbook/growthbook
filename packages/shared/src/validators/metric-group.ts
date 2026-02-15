import { z } from "zod";
import { apiBaseSchema, baseSchema } from "./base-model.js";

export const metricGroupValidator = baseSchema.safeExtend({
  owner: z.string(),
  name: z.string(),
  description: z.string(),
  tags: z.array(z.string()),
  projects: z.array(z.string()),
  metrics: z.array(z.string()),
  datasource: z.string(),
  archived: z.boolean(),
});

export const apiMetricGroupValidator = apiBaseSchema.safeExtend({
  owner: z.string(),
  name: z.string(),
  description: z.string(),
  tags: z.array(z.string()),
  projects: z.array(z.string()),
  metrics: z.array(z.string()),
  datasource: z.string(),
  archived: z.boolean(),
});

export const apiCreateMetricGroupBody = z.strictObject({
  name: z.string(),
  description: z.string(),
  tags: z.array(z.string()).optional(),
  projects: z.array(z.string()),
  metrics: z.array(z.string()),
  datasource: z.string(),
  owner: z.string().optional().describe("Will default to the current user"),
  archived: z.boolean().optional(),
});
export const apiUpdateMetricGroupBody = apiCreateMetricGroupBody.partial();
