import { z } from "zod";

export const experimentInfoSignificance = z
  .object({
    experimentName: z.string(),
    experimentId: z.string(),
    metricName: z.string(),
    metricId: z.string(),
    threshold: z.number(),
  })
  .strict();

export type ExperimentInfoSignificancePayload = z.infer<
  typeof experimentInfoSignificance
>;
