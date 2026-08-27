import { z } from "zod";
import { baseSchema } from "./base-model";

export const queryRunnerRunParentTypes = [
  "experimentSnapshot",
  "report",
  "metric",
  "pastExperiments",
  "metricAnalysis",
  "dimensionSlices",
  "safeRolloutSnapshot",
  "contextualBanditSnapshot",
  "aggregatedFactTableRun",
  "populationData",
  "productAnalyticsExploration",
] as const;

export type QueryRunnerRunParentType =
  (typeof queryRunnerRunParentTypes)[number];

export const queryRunnerRunValidator = baseSchema
  .extend({
    parentType: z.enum(queryRunnerRunParentTypes),
    parentId: z.string(),
    datasourceId: z.string(),

    // This starts empty because we first acquire the lock and then add the queries
    queryIds: z.array(z.string()),

    lockToken: z.string().nullable(),
    lockHeartbeatAt: z.date().nullable(),
  })
  .strict();

export type QueryRunnerRunInterface = z.infer<typeof queryRunnerRunValidator>;
