import { z } from "zod";

export const askDataAnswerValidator = z.object({
  summary: z
    .string()
    .max(1200)
    .describe(
      "2-4 sentences answering the question, citing real numbers from the query results.",
    ),
  assumptions: z
    .array(z.string())
    .min(1)
    .max(6)
    .describe(
      "Every interpretive choice: how you defined the measure, the date range, " +
        "rows you excluded, joins whose grain could be contested.",
    ),
  caveats: z
    .array(z.string())
    .max(4)
    .optional()
    .describe(
      "Reasons the number could be wrong or misleading — small samples, nulls, " +
        "results hitting the row cap, a table that looked stale.",
    ),
  sourceTables: z
    .array(z.string())
    .min(1)
    .describe("Fully-qualified tables the answer depends on."),
  confidence: z
    .enum(["high", "medium", "low"])
    .describe(
      "low when you guessed at a column meaning or the schema was ambiguous.",
    ),
});

export type AskDataAnswer = z.infer<typeof askDataAnswerValidator>;
