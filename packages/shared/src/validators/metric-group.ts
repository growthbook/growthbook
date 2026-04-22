import { z } from "zod";
import { apiBaseSchema, baseSchema } from "./base-model";
import { ownerEmailField, ownerField, ownerInputField } from "./owner-field";

import { namedSchema } from "./openapi-helpers";

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

export const apiMetricGroupValidator = namedSchema(
  "MetricGroup",
  apiBaseSchema.safeExtend({
    owner: ownerField,
    ownerEmail: ownerEmailField,
    name: z.string(),
    description: z.string(),
    tags: z.array(z.string()),
    projects: z.array(z.string()),
    metrics: z.array(z.string()),
    datasource: z.string(),
    archived: z.boolean(),
  }),
);

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
