import { z } from "zod";
import { CreateProps, UpdateProps } from "back-end/types/models";

export const analysisPlanCondition = z.object({
  match: z.enum(["all", "any", "none"]),
  metrics: z.enum(["goals", "guardrails"]),
  direction: z.enum(["statsigWinner", "statsigLoser", "trendingLoser"]),
});

export const analysisPlanRule = z.object({
  conditions: z.array(analysisPlanCondition),
  action: z.enum(["ship", "rollback", "review"]),
});

export type AnalysisPlanCondition = z.infer<typeof analysisPlanCondition>;
export type AnalysisPlanRule = z.infer<typeof analysisPlanRule>;

export const analysisPlanInterface = z
  .object({
    id: z.string(),
    organization: z.string(),
    project: z.string().optional(),
    owner: z.string(),
    dateCreated: z.date(),
    dateUpdated: z.date(),

    name: z.string(),
    description: z.string().optional(),

    rules: z.array(analysisPlanRule),
    defaultAction: z.enum(["ship", "rollback", "review"]),
  })
  .strict();

// TODO move to type file
export type CreateAnalysisPlanProps = CreateProps<AnalysisPlanInterface>;
export type UpdateAnalysisPlanProps = UpdateProps<AnalysisPlanInterface>;
export type AnalysisPlanInterface = z.infer<typeof analysisPlanInterface>;
