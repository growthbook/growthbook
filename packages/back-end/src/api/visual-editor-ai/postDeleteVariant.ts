import { z } from "zod";
import type { Changeset } from "shared/types/experiment";
import type { ExperimentInterfaceExcludingHoldouts } from "shared/validators";
import {
  findVisualChangesetById,
  toVisualChangesetApiInterface,
  updateVisualChangeset,
} from "back-end/src/models/VisualChangesetModel";
import {
  getExperimentById,
  updateExperiment,
} from "back-end/src/models/ExperimentModel";
import { validateExperimentChange } from "back-end/src/services/experimentChanges/changeExperimentStatus";
import { toExperimentApiInterface } from "back-end/src/services/experiments";
import { resolveOwnerEmail } from "back-end/src/services/owner";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { logger } from "back-end/src/util/logger";
import { requireUserAuth } from "./requireUserAuth";

const bodySchema = z
  .object({
    visualChangesetId: z.string(),
    // Internal variation `id` — matches experiment.variations[].id and
    // visualChange.variation.
    variationId: z.string(),
  })
  .strict();

const validation = {
  bodySchema,
  querySchema: z.never(),
  paramsSchema: z.never(),
  responseSchema: z.any(),
  method: "post" as const,
  path: "/visual-editor/delete-variant",
  operationId: "postVisualEditorDeleteVariant",
  // Internal Visual Editor extension endpoint — not part of the
  // public OpenAPI spec.
  excludeFromSpec: true,
};

// Removes a variation from the experiment (variations, every phase's
// variations list, and weights) plus its matching visual change. The inverse
// of postAddVariant. Returns the refreshed changeset + experiment so the side
// panel re-renders in one round-trip.
export const postDeleteVariant = createApiRequestHandler(validation)(async (
  req,
) => {
  const { visualChangesetId, variationId } = req.body;
  const context = req.context;
  requireUserAuth(context);

  const changeset = await findVisualChangesetById(
    visualChangesetId,
    req.organization.id,
  );
  if (!changeset)
    return context.throwNotFoundError("Visual changeset not found");

  const experiment = await getExperimentById(context, changeset.experiment);
  if (!experiment) return context.throwNotFoundError("Experiment not found");

  // Mutates the experiment AND the changeset — both gates required.
  if (!context.permissions.canUpdateExperiment(experiment, {})) {
    context.permissions.throwPermissionError();
  }
  if (!context.permissions.canUpdateVisualChange(experiment)) {
    context.permissions.throwPermissionError();
  }

  const idx = experiment.variations.findIndex((v) => v.id === variationId);
  if (idx < 0) {
    return context.throwBadRequestError(
      "Variation not found in this experiment",
    );
  }
  // Index 0 is the control/baseline — never removable here.
  if (idx === 0) {
    return context.throwBadRequestError(
      "The control variation can't be deleted",
    );
  }
  // Keep at least control + one variant.
  if (experiment.variations.length <= 2) {
    return context.throwBadRequestError(
      "An experiment must keep at least one variant besides control",
    );
  }

  const nextVariations = experiment.variations.filter(
    (v) => v.id !== variationId,
  );

  // Drop the variation from every phase. variationWeights is positionally
  // aligned with experiment.variations (see toExperimentApiInterface). When a
  // phase's weight count matches that alignment, remove the weight at the
  // deleted variation's index `idx` and renormalize the REMAINING weights so
  // they still sum to 1 — preserving the phase's original allocation ratios
  // instead of flattening historical phases to an equal split. If a phase's
  // weights don't line up (legacy / malformed data), we can't map by index,
  // so fall back to an equal split of the correct new length. Also remove the
  // variation from the phase's own variations list so no phase references a
  // variation the experiment no longer has.
  const originalCount = experiment.variations.length;
  const phases = (experiment.phases || []).map((p) => {
    const next = { ...p };
    if (next.variations !== undefined) {
      next.variations = next.variations.filter((pv) => pv.id !== variationId);
    }
    if (next.variationWeights !== undefined && next.variationWeights.length) {
      next.variationWeights =
        next.variationWeights.length === originalCount
          ? renormalizeWeights(
              next.variationWeights.filter((_, i) => i !== idx),
            )
          : renormalizeWeights(new Array(nextVariations.length).fill(1));
    }
    return next;
  });

  const changes: Changeset = {
    variations: nextVariations,
    ...(phases.length > 0 ? { phases } : {}),
  };
  await validateExperimentChange({ context, experiment, changes });

  const nextVisualChanges = changeset.visualChanges.filter(
    (vc) => vc.variation !== variationId,
  );

  // Two documents, two writes, and no cross-collection transaction is
  // available here. Do the REVERSIBLE write (remove the variation) first and
  // the DESTRUCTIVE one (drop the user-authored visual change) second. If the
  // visual-change write fails, roll the experiment back — so we never (a) lose
  // the variant's authored css/js/domMutations while the variant survives, nor
  // (b) orphan a visual change onto a variation that no longer exists. The
  // snapshot below (copies, taken before the first write) drives the rollback.
  const rollback: Changeset = {
    variations: experiment.variations.map((v) => ({ ...v })),
    ...(experiment.phases
      ? { phases: experiment.phases.map((p) => ({ ...p })) }
      : {}),
  };
  const deleted = await updateExperiment({ context, experiment, changes });
  try {
    await updateVisualChangeset({
      visualChangeset: changeset,
      experiment,
      context,
      updates: { visualChanges: nextVisualChanges },
    });
  } catch (e) {
    try {
      // Restore against the POST-delete experiment (`deleted`), not the
      // original: updateExperiment early-returns when hasActualChanges finds
      // no diff, so diffing the rollback against the unchanged original object
      // would silently skip the write and leave the variation deleted.
      await updateExperiment({
        context,
        experiment: deleted,
        changes: rollback,
      });
    } catch (rollbackErr) {
      // Rollback also failed: the variation is gone but its visual change is
      // still stored (orphaned). Content isn't lost — log for cleanup.
      logger.error(
        { err: rollbackErr, variationId, visualChangesetId },
        "[visual-editor/delete-variant] rollback failed after visual-change write error; variation removed but its visual change remains",
      );
    }
    throw e;
  }

  // Re-read so the response matches the initial-load shape.
  const refreshedChangeset = await findVisualChangesetById(
    visualChangesetId,
    req.organization.id,
  );
  const refreshedExperiment = await getExperimentById(
    context,
    changeset.experiment,
  );
  if (!refreshedExperiment) {
    throw new Error("Experiment vanished between write and re-read");
  }
  if (refreshedExperiment.type === "holdout") {
    throw new Error("Visual changesets are not supported on holdouts");
  }
  const apiExperiment = await resolveOwnerEmail(
    await toExperimentApiInterface(
      context,
      refreshedExperiment as ExperimentInterfaceExcludingHoldouts,
    ),
    context,
  );

  return {
    visualChangeset: refreshedChangeset
      ? toVisualChangesetApiInterface(refreshedChangeset)
      : null,
    experiment: apiExperiment,
  };
});

// Rescale weights so they sum to 1 while preserving their ratios. Falls back
// to an equal split only when every remaining weight is zero. Rounds to 4 dp
// and absorbs the rounding drift into the first entry (matching the weight
// convention used by postAddVariant).
function renormalizeWeights(weights: number[]): number[] {
  if (weights.length === 0) return weights;
  const sum = weights.reduce((a, b) => a + b, 0);
  const base =
    sum > 0
      ? weights.map((w) => Number((w / sum).toFixed(4)))
      : new Array(weights.length).fill(Number((1 / weights.length).toFixed(4)));
  const drift = Number((1 - base.reduce((a, b) => a + b, 0)).toFixed(4));
  base[0] = Number((base[0] + drift).toFixed(4));
  return base;
}
