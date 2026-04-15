import { z } from "zod";
import { apiBaseSchema, baseSchema } from "./base-model";
import { ownerField, ownerInputField } from "./owner-field";

export const metricGroupValidator = baseSchema.safeExtend({
  owner: ownerField,
  name: z.string(),
  description: z.string(),
  tags: z.array(z.string()),
  projects: z.array(z.string()),
  metrics: z.array(z.string()),
  datasource: z.string(),
  archived: z.boolean(),
});

export const apiMetricGroupValidator = apiBaseSchema.safeExtend({
  owner: ownerField,
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
  owner: ownerInputField.optional(),
  archived: z.boolean().optional(),
});
export const apiUpdateMetricGroupBody = apiCreateMetricGroupBody.partial();
