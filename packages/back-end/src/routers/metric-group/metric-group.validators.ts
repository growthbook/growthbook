import { z } from "zod";

export const createMetricGroupPropsValidator = z
  .object({
    name: z.string(),
    description: z.string().optional(),
    datasource: z.string(),
    metrics: z.array(z.string()).optional(),
    owner: z.string(),
    projects: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
    archived: z.boolean().optional(),
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
    archived: z.boolean().optional(),
  })
  .strict();

export const updateOrderValidator = z
  .object({
    from: z.number(),
    to: z.number(),
  })
  .strict();
