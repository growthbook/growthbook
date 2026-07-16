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

  // Drop the variation from every phase's variations list, and equal-
  // redistribute weights in any phase that carries them (matching the
  // equal-split behavior of add-variant). Done across all phases so no phase
  // is left referencing a variation the experiment no longer has.
  const n = nextVariations.length;
  const equal = Number((1 / n).toFixed(4));
  const phases = (experiment.phases || []).map((p) => {
    const next = { ...p };
    if (next.variations !== undefined) {
      next.variations = next.variations.filter((pv) => pv.id !== variationId);
    }
    if (
      next.variationWeights !== undefined &&
      next.variationWeights.length > 0
    ) {
      const weights = new Array(n).fill(equal);
      const sum = weights.reduce((a, b) => a + b, 0);
      // Absorb rounding into the first weight so they sum to 1.
      weights[0] = Number((weights[0] + (1 - sum)).toFixed(4));
      next.variationWeights = weights;
    }
    return next;
  });

  const changes: Changeset = {
    variations: nextVariations,
    ...(phases.length > 0 ? { phases } : {}),
  };
  await validateExperimentChange({ context, experiment, changes });
  await updateExperiment({ context, experiment, changes });

  const nextVisualChanges = changeset.visualChanges.filter(
    (vc) => vc.variation !== variationId,
  );
  await updateVisualChangeset({
    visualChangeset: changeset,
    experiment,
    context,
    updates: { visualChanges: nextVisualChanges },
  });

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
