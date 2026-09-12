import { z } from "zod";
import { createFactTablePropsValidator } from "shared/validators";

// Fact metric bodies are validated by FactMetricModel; only pin what is read here
export const migrateLegacyMetricsValidator = z
  .object({
    archive: z.boolean(),
    groups: z
      .array(
        z
          .object({
            factTable: createFactTablePropsValidator.extend({ id: z.string() }),
            existing: z.boolean(),
            // Empty when the table is only created for a referencing metric
            metrics: z.array(
              z
                .object({
                  id: z.string(),
                  replaces: z.array(z.string()).min(1),
                })
                .passthrough(),
            ),
          })
          .strict(),
      )
      .min(1)
      // Above the front-end batch size, which adds referenced tables on top
      .max(50),
  })
  .strict();

export type MigrateLegacyMetricsBody = z.infer<
  typeof migrateLegacyMetricsValidator
>;
