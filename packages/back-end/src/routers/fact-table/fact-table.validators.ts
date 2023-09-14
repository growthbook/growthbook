import { z } from "zod";

export const createFactTablePropsValidator = z
  .object({
    name: z.string(),
    description: z.string(),
    id: z.string().optional(),
    owner: z.string(),
    projects: z.array(z.string()),
    datasource: z.string(),
    userIdTypes: z.array(z.string()),
    sql: z.string(),
  })
  .strict();

export const updateFactTablePropsValidator = z
  .object({
    name: z.string().optional(),
    description: z.string().optional(),
    owner: z.string().optional(),
    projects: z.array(z.string()).optional(),
    userIdTypes: z.array(z.string()).optional(),
    sql: z.string().optional(),
  })
  .strict();
export const factTypeValidator = z.enum(["number", "row"]);
export const numberFormatValidator = z.enum([
  "number",
  "currency",
  "time:seconds",
]);

export const createFactPropsValidator = z
  .object({
    id: z.string().optional(),
    name: z.string(),
    description: z.string(),
    type: factTypeValidator,
    column: z.string(),
    numberFormat: numberFormatValidator,
    where: z.string(),
  })
  .strict();

export const updateFactPropsValidator = z
  .object({
    name: z.string(),
    description: z.string(),
    column: z.string(),
    numberFormat: numberFormatValidator,
    where: z.string(),
  })
  .strict();
