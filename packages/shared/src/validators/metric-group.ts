import { z } from "zod";

export const metricGroupValidator = z
  .object({
    id: z.string(),
    organization: z.string(),
    owner: z.string(),
    dateCreated: z.date(),
    dateUpdated: z.date(),
    name: z.string(),
    description: z.string(),
    tags: z.array(z.string()),
    projects: z.array(z.string()),
    metrics: z.array(z.string()),
    datasource: z.string(),
    archived: z.boolean(),
  })
  .strict();
