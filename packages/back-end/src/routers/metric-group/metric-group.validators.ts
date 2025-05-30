import { z } from "zod";

export const createMetricGroupPropsValidator = z
  .object({
    name: z.string(),
    description: z.string().optional(),
    datasource: z.string(),
    metrics: z.array(z.string()).optional(),
    owner: z.string().default(""),
    projects: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
    archived: z.boolean().default(false).optional(),
  })
  .strict();

export const updateMetricGroupPropsValidator = z
  .object({
    name: z.string().optional(),
    metrics: z.array(z.string()).optional(),
    datasource: z.string().optional(),
    description: z.string().optional(),
    owner: z.string().optional(),
    projects: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
    archived: z.boolean().default(false).optional(),
  })
  .strict();

export const metricGroupValidator = z
  .object({
    id: z.string(),
    organization: z.string(),
    owner: z.string().default(""),
    dateCreated: z.date(),
    dateUpdated: z.date(),
    name: z.string(),
    description: z.string(),
    tags: z.array(z.string()).default([]),
    projects: z.array(z.string()),
    metrics: z.array(z.string()),
    datasource: z.string(),
    archived: z.boolean().default(false),
  })
  .strict();

export const updateOrderValidator = z
  .object({
    from: z.number(),
    to: z.number(),
  })
  .strict();
