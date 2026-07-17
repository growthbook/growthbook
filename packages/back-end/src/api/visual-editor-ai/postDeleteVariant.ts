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

  // Remove the visual change FIRST, then the variation. If the second write
  // fails we're left with a variation that has no visual change (a benign
  // blank variant) rather than a visual change orphaned onto a variation the
  // experiment no longer has.
  const nextVisualChanges = changeset.visualChanges.filter(
    (vc) => vc.variation !== variationId,
  );
  await updateVisualChangeset({
    visualChangeset: changeset,
    experiment,
    context,
    updates: { visualChanges: nextVisualChanges },
  });
  await updateExperiment({ context, experiment, changes });

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
