import { z } from "zod";

export const savedQueryValidator = z
  .object({
    id: z.string(),
    organization: z.string(),
    datasourceId: z.string(),
    dateCreated: z.date(),
    dateUpdated: z.date(),
    name: z.string(),
    description: z.string().optional(),
    sql: z.string(),
    results: z.array(z.any()).optional(), //MKTODO: Is there a better data structure for this?
    dateLastRan: z.date().optional(),
  })
  .strict();

export type SavedQuery = z.infer<typeof savedQueryValidator>;
