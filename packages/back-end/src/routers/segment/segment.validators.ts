import { z } from "zod";

export const segmentValidator = z
  .object({
    id: z.string(),
    organization: z.string(),
    owner: z.string().default(""),
    datasource: z.string(),
    dateCreated: z.date(),
    dateUpdated: z.date(),
    name: z.string(),
    description: z.string(),
    userIdType: z.string(),
    sql: z.string(),
  })
  .strict();
