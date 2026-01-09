import { z } from "zod";

export const baseSchema = z
  .object({
    id: z.string(),
    organization: z.string(),
    dateCreated: z.date(),
    dateUpdated: z.date(),
  })
  .strict();

export const apiBaseSchema = z
  .object({
    id: z.string(),
    dateCreated: z.iso.datetime(),
    dateUpdated: z.iso.datetime(),
  })
  .strict();
