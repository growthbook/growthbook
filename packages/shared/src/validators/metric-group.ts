import { z } from "zod";
import { MAX_DESCRIPTION_LENGTH } from "shared/constants";
import { apiBaseSchema, baseSchema } from "./base-model";
import { ownerEmailField, ownerField, ownerInputField } from "./owner-field";

import { namedSchema } from "./openapi-helpers";
import {
  GENERIC_NAME_DESCRIPTION,
  PLAIN_DESCRIPTION,
  PROJECTS_DESCRIPTION,
  TAGS_DESCRIPTION,
} from "./api-field-descriptions";

export const metricGroupValidator = baseSchema.safeExtend({
  owner: ownerField,
  name: z.string(),
  description: z.string().max(MAX_DESCRIPTION_LENGTH),
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
    description: z.string().max(MAX_DESCRIPTION_LENGTH),
    tags: z.array(z.string()),
    projects: z.array(z.string()),
    metrics: z.array(z.string()),
    datasource: z.string(),
    archived: z.boolean(),
  }),
);

export const apiCreateMetricGroupBody = z.strictObject({
  name: z.string().describe(GENERIC_NAME_DESCRIPTION),
  description: z
    .string()
    .max(MAX_DESCRIPTION_LENGTH)
    .describe(PLAIN_DESCRIPTION),
  tags: z.array(z.string()).describe(TAGS_DESCRIPTION).optional(),
  projects: z.array(z.string()).describe(PROJECTS_DESCRIPTION),
  metrics: z.array(z.string()),
  datasource: z.string(),
  owner: ownerInputField.optional(),
  archived: z.boolean().optional(),
});
export const apiUpdateMetricGroupBody = apiCreateMetricGroupBody.partial();
