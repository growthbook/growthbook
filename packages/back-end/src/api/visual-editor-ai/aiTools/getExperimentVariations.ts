import { tool as aiTool } from "ai";
import { z } from "zod";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { findVisualChangesetsByExperiment } from "back-end/src/models/VisualChangesetModel";
import { logger } from "back-end/src/util/logger";
import type { ApiReqContext } from "back-end/types/api";

// Returns variations + their visual changes for one past experiment.
// Permission is enforced by getExperimentById (null when the caller
// can't read it) — the AI gets a clean "not found" rather than
// silently bypassing access controls.

const inputSchema = z.object({
  experimentId: z
    .string()
    .describe(
      "The id of an experiment, usually obtained from a prior searchPastExperiments call.",
    ),
});

// Cap on the markup we expose per mutation, to keep prompt size sane
// when an experiment has 50 mutations across 4 variations. Truncated
// values are flagged via the `truncated` field.
const VALUE_CAP = 400;

function truncate(v: string | null | undefined): {
  value: string | null;
  truncated: boolean;
} {
  if (v == null) return { value: null, truncated: false };
  if (v.length <= VALUE_CAP) return { value: v, truncated: false };
  return { value: v.slice(0, VALUE_CAP), truncated: true };
}

export function getExperimentVariationsTool(context: ApiReqContext) {
  return aiTool({
    description:
      "Fetch the variations of a past experiment along with the visual changes (DOM mutations, global CSS, global JS) that were applied to each. Call this AFTER searchPastExperiments has surfaced a relevant experiment id, when the user wants to mirror or adapt a prior variation's edits. Long mutation values are truncated; use them as patterns, not as verbatim source.",
    inputSchema,
    execute: async ({ experimentId }) => {
      try {
        const exp = await getExperimentById(context, experimentId);
        if (!exp) {
          return {
            ok: false,
            error:
              "Experiment not found or not readable by this user. Make sure the id came from a recent searchPastExperiments result.",
          } as const;
        }

        const vcs = await findVisualChangesetsByExperiment(
          exp.id,
          context.org.id,
        );

        const variations = exp.variations.map((v, idx) => {
          // Each VisualChangeset has one VisualChange per variation
          // (with matching variation id). Collapse across changesets —
          // a multi-page experiment has multiple changesets but the
          // AI rarely cares about the URL split.
          const allMutations = vcs.flatMap((vc) =>
            (
              vc.visualChanges.find((c) => c.variation === v.id)
                ?.domMutations ?? []
            ).map((m) => ({
              selector: m.selector,
              action: m.action,
              attribute: m.attribute,
              ...truncate(m.value ?? null),
            })),
          );
          const css = vcs
            .map(
              (vc) =>
                vc.visualChanges.find((c) => c.variation === v.id)?.css ?? "",
            )
            .filter(Boolean);
          const js = vcs
            .map(
              (vc) =>
                vc.visualChanges.find((c) => c.variation === v.id)?.js ?? "",
            )
            .filter(Boolean);
          return {
            index: idx,
            id: v.id,
            name: v.name,
            key: v.key,
            mutations: allMutations,
            css: css.join("\n\n"),
            js: js.join("\n\n"),
          };
        });

        return {
          ok: true,
          experiment: {
            id: exp.id,
            name: exp.name,
            hypothesis: exp.hypothesis || null,
            status: exp.status,
          },
          variations,
        } as const;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.warn(
          { err: e, orgId: context.org.id, experimentId },
          "[ai-tool/get-experiment-variations] failed",
        );
        return { ok: false, error: msg } as const;
      }
    },
  });
}
