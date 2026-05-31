import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import type {
  ExperimentInterfaceExcludingHoldouts,
  PhaseVariation,
} from "shared/validators";
import {
  findVisualChangesetById,
  toVisualChangesetApiInterface,
  updateVisualChangeset,
} from "back-end/src/models/VisualChangesetModel";
import {
  getExperimentById,
  updateExperiment,
} from "back-end/src/models/ExperimentModel";
import { toExperimentApiInterface } from "back-end/src/services/experiments";
import { resolveOwnerEmail } from "back-end/src/services/owner";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { requireUserAuth } from "./requireUserAuth";

const bodySchema = z
  .object({
    visualChangesetId: z.string(),
    name: z.string().min(1).max(120).optional(),
  })
  .strict();

const validation = {
  bodySchema,
  querySchema: z.never(),
  paramsSchema: z.never(),
  responseSchema: z.any(),
  method: "post" as const,
  path: "/visual-editor/add-variant",
  operationId: "postVisualEditorAddVariant",
};

// Appends a new variation to the experiment AND a matching visualChange to
// the changeset, atomically (as much as we can with two model writes).
// Returns both objects so the side panel can refresh in one round-trip.
export const postAddVariant = createApiRequestHandler(validation)(async (
  req,
) => {
  const { visualChangesetId, name } = req.body;
  const context = req.context;
  // Require PAT auth — mutates the experiment's variations array; we
  // want the change attributable to a real user.
  requireUserAuth(context);

  const changeset = await findVisualChangesetById(
    visualChangesetId,
    req.organization.id,
  );
  if (!changeset)
    return context.throwNotFoundError("Visual changeset not found");

  const experiment = await getExperimentById(context, changeset.experiment);
  if (!experiment) return context.throwNotFoundError("Experiment not found");

  // This endpoint mutates BOTH the experiment (adding a variation) and the
  // visual changeset (adding a matching visualChange entry). Gate on both
  // permissions so neither write happens without the right access.
  if (!context.permissions.canUpdateExperiment(experiment, {})) {
    context.permissions.throwPermissionError();
  }
  if (!context.permissions.canUpdateVisualChange(experiment)) {
    context.permissions.throwPermissionError();
  }

  // Build the new variation. Position is appended at the end so existing
  // variation IDs and the visualChanges order are preserved.
  // Internal experiment.variations entries are keyed by `id` (not the
  // API-level `variationId`) — that's also what visualChange.variation
  // references downstream and what getLatestPhaseVariations matches by.
  const nextIndex = experiment.variations.length;
  const newVariationId = uuidv4();
  const newVariationName = name?.trim() || `Variant ${nextIndex}`;
  const newVariationKey = `${nextIndex}`;

  const nextVariations = [
    ...experiment.variations,
    {
      id: newVariationId,
      key: newVariationKey,
      name: newVariationName,
      description: "",
      screenshots: [],
    },
  ];

  // The GrowthBook UI enumerates variants via getLatestPhaseVariations,
  // which filters the top-level array by `phase.variations[].id`. If we
  // don't also add the new id to the latest phase, the new variant will
  // be silently dropped from the experiment page. Equal-weight redistribute
  // the traffic across all variations on the same phase.
  // We reuse the zod-derived PhaseVariation type from shared/validators so
  // the shape stays in sync with the canonical schema and we don't need
  // an unsafe cast.
  const phases = (experiment.phases || []).map((p) => ({ ...p }));
  if (phases.length > 0) {
    const latest = phases[phases.length - 1];
    if (latest.variations !== undefined) {
      const newPhaseVariations: PhaseVariation[] = [
        ...latest.variations,
        { id: newVariationId, status: "active" },
      ];
      latest.variations = newPhaseVariations;
    }
    if (
      latest.variationWeights !== undefined &&
      latest.variationWeights.length > 0
    ) {
      const n = nextVariations.length;
      const equal = Number((1 / n).toFixed(4));
      // Spread last bit of rounding into the first weight so they sum to 1.
      const weights = new Array(n).fill(equal);
      const sum = weights.reduce((a, b) => a + b, 0);
      weights[0] = Number((weights[0] + (1 - sum)).toFixed(4));
      latest.variationWeights = weights;
    }
  }

  await updateExperiment({
    context,
    experiment,
    changes: {
      variations: nextVariations,
      ...(phases.length > 0 ? { phases } : {}),
    },
  });

  // Append a new visualChange referencing the new variation id. The merge
  // logic in updateVisualChangeset() will mint a `vc.id` for us because we
  // omit it on the new entry.
  const nextVisualChanges = [
    ...changeset.visualChanges,
    {
      variation: newVariationId,
      description: newVariationName,
      css: "",
      js: "",
      domMutations: [],
    },
  ];

  await updateVisualChangeset({
    visualChangeset: changeset,
    experiment,
    context,
    updates: { visualChanges: nextVisualChanges },
  });

  // Re-read both for the freshest server state to return. The experiment
  // gets converted to its API shape so the side panel sees variation IDs
  // under `variationId` (not the internal `id` field) — matching the
  // initial-load response shape.
  const refreshedChangeset = await findVisualChangesetById(
    visualChangesetId,
    req.organization.id,
  );
  const refreshedExperiment = await getExperimentById(
    context,
    changeset.experiment,
  );

  // toExperimentApiInterface excludes holdout-type experiments at its
  // type signature. Visual changesets don't apply to holdouts in practice
  // — if we somehow loaded one, fail loudly rather than silently dropping
  // experiment state from the response. Other endpoints in this codebase
  // use the same runtime-check-then-cast pattern (see
  // packages/back-end/src/api/experiments/updateExperiment.ts:296) because
  // type-only narrowing on the optional `type` field doesn't carry
  // through.
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
    newVariationId,
  };
});
