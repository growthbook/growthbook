import { z } from "zod";

export const analysisPlanRule = z
  .object({
    goalMetricStatus: z.enum([
      "allStatSigWinner",
      "allStatSigLoser",
      "anyStatSigWinnerNoneStatSigLoser",
      "neutral",
      "anyStatSigLoser",
    ]),
    guardrailMetricStatus: z.enum([
      "anyStatSigLoser", 
      "anyTrendingLoser", 
      "neutral",
    ]),
    decision: z.enum(["ship", "rollback", "review"]),
  })

// Clinical trial
// Gold standard

// Coin Flip
// Do no harm
// Two-way door

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
  })
  .strict();
export type AnalysisPlanInterface = z.infer<
  typeof analysisPlanInterface
>;