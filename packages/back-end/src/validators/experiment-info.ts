import { z } from "zod";

export const experimentInfoSignificance = z
  .object({
    experimentName: z.string(),
    experimentId: z.string(),
    statsEngine: z.string(),
    variations: z.array(
      z
        .object({
          variationId: z.string(),
          variationName: z.string(),
          metrics: z.array(
            z
              .object({
                metricName: z.string(),
                metricId: z.string(),
                criticalValue: z.number(),
                winning: z.boolean(),
              })
              .strict()
          ),
        })
        .strict()
    ),
  })
  .strict();

export type ExperimentInfoSignificancePayload = z.infer<
  typeof experimentInfoSignificance
>;
