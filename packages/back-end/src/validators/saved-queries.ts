import { z } from "zod";

// TODO: Add a proper type for the data viz config
export const dataVizConfigValidator = z.any();

export const savedQueryValidator = z
  .object({
    id: z.string(),
    organization: z.string(),
    datasourceId: z.string(),
    dateCreated: z.date(),
    dateUpdated: z.date(),
    name: z.string(),
    dateLastRan: z.date(),
    sql: z.string(),
    dataVizConfig: z.array(dataVizConfigValidator).optional(),
    results: z.array(z.any()), // MKTODO: Add a proper type for the results
  })
  .strict();

export type SavedQuery = z.infer<typeof savedQueryValidator>;
export type DataVizConfig = z.infer<typeof dataVizConfigValidator>;
