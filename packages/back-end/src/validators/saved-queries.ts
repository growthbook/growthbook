import { z } from "zod";

export const dataVizConfigValidator = z.object({
  chartType: z.enum(["bar", "line", "pie", "scatter", "area", "donut"]),
  xAxis: z.string(),
  yAxis: z.string(),
});

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
    dataVizConfig: dataVizConfigValidator.optional(),
    results: z.array(z.any()), // MKTODO: Add a proper type for the results
  })
  .strict();

export type SavedQuery = z.infer<typeof savedQueryValidator>;
export type DataVizConfig = z.infer<typeof dataVizConfigValidator>;
