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
    dateLastRan: z.date(),
    sql: z.string(),
    results: z.array(z.any()), // MKTODO: Add a proper type for the results
  })
  .strict();

export type SavedQuery = z.infer<typeof savedQueryValidator>;
