import { tool as aiTool } from "ai";
import { z } from "zod";
import { getAllExperiments } from "back-end/src/models/ExperimentModel";
import { findVisualChangesetsByExperiment } from "back-end/src/models/VisualChangesetModel";
import { logger } from "back-end/src/util/logger";
import type { ApiReqContext } from "back-end/types/api";

// Search past experiments by free text against name + hypothesis +
// description. getAllExperiments filters by the caller's read
// permission so results are scoped automatically — the AI only ever
// sees experiments the user could open in the web app themselves.

const inputSchema = z.object({
  query: z
    .string()
    .min(1)
    .max(200)
    .describe(
      "Free-text search across experiment names, hypotheses, and descriptions. E.g., 'pricing CTA', 'hero copy', 'signup form'.",
    ),
  status: z
    .enum(["any", "running", "stopped", "draft"])
    .default("any")
    .describe(
      "Optionally filter by experiment status. 'stopped' is the most useful for learning from completed tests.",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(20)
    .default(8)
    .describe("How many results to return. Default 8."),
});

// Cap on the candidate set we materialize before in-memory filtering.
// In-memory filter for substring match is simpler than a Mongo $text
// index, but we cap to bound pathological-org cost.
const CANDIDATE_CAP = 500;

export function searchPastExperimentsTool(context: ApiReqContext) {
  return aiTool({
    description:
      "Search the user's past A/B test experiments by name, hypothesis, or description. Call this when the user references prior work ('try what we did on the pricing page', 'similar to the signup test', 'what's worked here before'). Returns a list of experiments with their name, hypothesis, status, and ids — NOT result data. Use these results to inform direction, not as a source of numeric claims.",
    inputSchema,
    execute: async ({ query, status, limit }) => {
      try {
        // Pull a wide candidate set, then substring-filter in memory.
        // getAllExperiments already applies the user's read perms.
        const experiments = await getAllExperiments(context, {
          includeArchived: false,
          ...(status !== "any" ? { status } : {}),
          limit: CANDIDATE_CAP,
          sortBy: { dateUpdated: -1 },
        });

        const q = query.toLowerCase();
        const matches = experiments.filter((e) => {
          const hay = `${e.name || ""}\n${e.hypothesis || ""}\n${
            e.description || ""
          }`.toLowerCase();
          return hay.includes(q);
        });

        // For each match, surface a compact summary and a flag for whether
        // the experiment has visual changes (so the AI knows getExperiment-
        // Variations will return something useful).
        const results = await Promise.all(
          matches.slice(0, limit).map(async (e) => {
            const vcs = await findVisualChangesetsByExperiment(
              e.id,
              context.org.id,
            );
            return {
              id: e.id,
              name: e.name,
              hypothesis: e.hypothesis || null,
              status: e.status,
              variationCount: e.variations?.length ?? 0,
              hasVisualChanges: vcs.length > 0,
              dateUpdated: e.dateUpdated?.toISOString?.() ?? null,
            };
          }),
        );

        return { ok: true, results } as const;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.warn(
          { err: e, orgId: context.org.id },
          "[ai-tool/search-past-experiments] failed",
        );
        return { ok: false, error: msg } as const;
      }
    },
  });
}
