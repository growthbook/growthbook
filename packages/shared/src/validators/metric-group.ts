import { z } from "zod";
import { apiBaseSchema, baseSchema } from "./base-model";

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
});
export const apiUpdateMetricGroupBody = apiCreateMetricGroupBody
  .safeExtend({ archived: z.boolean() })
  .partial();
