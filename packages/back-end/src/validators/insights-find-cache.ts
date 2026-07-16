import { z } from "zod";
import { aiInsightSuggestionValidator } from "shared/validators";

// Short-lived cache of AI "find insights" results, keyed by a hash of the
// analyzed experiment set + saved-insights state. Lets users close and
// reopen the find-insights modal without re-paying the AI cost.
export const insightsFindCache = z
  .object({
    id: z.string(),
    organization: z.string(),
    // sha256 hash of the inputs that determine the AI output (see
    // insights.controller.ts). Unique per organization.
    key: z.string(),
    suggestions: z.array(aiInsightSuggestionValidator),
    numExperimentsRequested: z.number(),
    numExperimentsAnalyzed: z.number(),
    dateCreated: z.date(),
    dateUpdated: z.date(),
  })
  .strict();

export type InsightsFindCache = z.infer<typeof insightsFindCache>;
