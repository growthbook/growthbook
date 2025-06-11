import { z } from "zod/v4";

export const experimentInfoSignificance = z
  .object({
    experimentName: z.string(),
    experimentId: z.string(),
    variationId: z.string(),
    variationName: z.string(),
    metricName: z.string(),
    metricId: z.string(),
    statsEngine: z.string(),
    criticalValue: z.number(),
    winning: z.boolean(),
  })
  .strict();

export type ExperimentInfoSignificancePayload = z.infer<
  typeof experimentInfoSignificance
>;
