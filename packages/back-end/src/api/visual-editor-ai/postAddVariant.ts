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
    // When set, the new variant is a duplicate: its css / js / domMutations
    // are copied from this existing variation (matched on the internal
    // `variation` id). Omit for a blank variant.
    sourceVariationId: z.string().optional(),
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
  // Internal Visual Editor extension endpoint — not part of the
  // public OpenAPI spec.
  excludeFromSpec: true,
};

// Appends a variation to the experiment and a matching visualChange to
// the changeset. Returns both so the side panel refreshes in one round-trip.
export const postAddVariant = createApiRequestHandler(validation)(async (
  req,
) => {
  const { visualChangesetId, name, sourceVariationId } = req.body;
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

  // For a duplicate, resolve the source variation's visual change (matched
  // on the internal `variation` id) and the source variation itself (for the
  // default "(copy)" name). Fail loudly on an unknown id rather than silently
  // creating a blank variant.
  const sourceChange = sourceVariationId
    ? changeset.visualChanges.find((vc) => vc.variation === sourceVariationId)
    : undefined;
  const sourceVariation = sourceVariationId
    ? experiment.variations.find((v) => v.id === sourceVariationId)
    : undefined;
  if (sourceVariationId && !sourceChange) {
    return context.throwBadRequestError(
      "Source variation not found in this changeset",
    );
  }

  // Internal `id` (not API-level `variationId`) — that's what
  // visualChange.variation references and getLatestPhaseVariations matches.
  const nextIndex = experiment.variations.length;
  const newVariationId = uuidv4();
  const defaultName = sourceVariation
    ? `${sourceVariation.name} (copy)`
    : `Variant ${nextIndex}`;
  const newVariationName = name?.trim() || defaultName;
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

  // getLatestPhaseVariations filters by `phase.variations[].id` — without
  // also adding the new id here, the variant is silently dropped from the
  // experiment page. Weights are equal-redistributed.
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
      // Absorb rounding into the first weight so they sum to 1.
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

  // Omitting `id` lets updateVisualChangeset's merge logic mint one. For a
  // duplicate we copy the source's css / js / domMutations (deep-copying each
  // mutation so the two variations don't share object references).
  const nextVisualChanges = [
    ...changeset.visualChanges,
    {
      variation: newVariationId,
      description: newVariationName,
      css: sourceChange?.css ?? "",
      js: sourceChange?.js ?? "",
      domMutations: (sourceChange?.domMutations ?? []).map((m) => ({ ...m })),
    },
  ];

  await updateVisualChangeset({
    visualChangeset: changeset,
    experiment,
    context,
    updates: { visualChanges: nextVisualChanges },
  });

  // Re-read so the response matches the initial-load shape (variation
  // IDs under `variationId` rather than the internal `id`).
  const refreshedChangeset = await findVisualChangesetById(
    visualChangesetId,
    req.organization.id,
  );
  const refreshedExperiment = await getExperimentById(
    context,
    changeset.experiment,
  );

  // toExperimentApiInterface's type signature excludes holdouts; use the
  // runtime-check-then-cast pattern (see api/experiments/updateExperiment.ts).
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
