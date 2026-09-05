import { z } from "zod";
import { createFactTablePropsValidator } from "shared/validators";

// One fact table plus the fact metrics that move onto it. The fact metric
// bodies are validated by FactMetricModel on create, so only the fields the
// migration itself relies on are pinned here.
export const migrateLegacyMetricsValidator = z
  .object({
    archive: z.boolean(),
    groups: z
      .array(
        z
          .object({
            factTable: createFactTablePropsValidator.extend({ id: z.string() }),
            // The fact table already exists; do not create it
            existing: z.boolean(),
            // May be empty: a table can be created only because a selected
            // ratio or funnel metric references it
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
      .max(25),
  })
  .strict();

export type MigrateLegacyMetricsBody = z.infer<
  typeof migrateLegacyMetricsValidator
>;
