import { z } from "zod";
import {
  findVisualChangesetById,
  toVisualChangesetApiInterface,
  updateVisualChangeset,
} from "back-end/src/models/VisualChangesetModel";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { loadChangesetWithOwner } from "back-end/src/api/visual-editor-ai/loadChangesetWithOwner";
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

// Appends a variation to the owner and a matching visualChange to
// the changeset. Returns both so the side panel refreshes in one round-trip.
export const postAddVariant = createApiRequestHandler(validation)(async (
  req,
) => {
  const { visualChangesetId, name, sourceVariationId } = req.body;
  const context = req.context;
  requireUserAuth(context);

  const { changeset, owner } = await loadChangesetWithOwner(
    context,
    visualChangesetId,
  );

  // Mutates the owner AND the changeset — both gates required.
  if (!owner.canManageVariations()) {
    context.permissions.throwPermissionError();
  }
  const auditLiveEdit = owner.requireWrite(req, {
    allowRunning: false,
    visualChangesetId,
  });

  // For a duplicate, resolve the source variation's visual change (matched
  // on the internal `variation` id). Fail loudly on an unknown id rather
  // than silently creating a blank variant.
  const sourceChange = sourceVariationId
    ? changeset.visualChanges.find((vc) => vc.variation === sourceVariationId)
    : undefined;
  const sourceVariation = sourceVariationId
    ? owner.editableVariations().find((v) => v.id === sourceVariationId)
    : undefined;
  if (sourceVariationId && (!sourceChange || !sourceVariation)) {
    return context.throwBadRequestError(
      "Source variation not found in this changeset",
    );
  }

  const added = await owner.addVariation({ name, sourceVariationId });

  const current =
    (await findVisualChangesetById(visualChangesetId, req.organization.id)) ??
    changeset;

  // Omitting `id` lets updateVisualChangeset's merge logic mint one. For a
  // duplicate we copy the source's css / js / domMutations (deep-copying each
  // mutation so the two variations don't share object references).
  const nextVisualChanges = [
    ...current.visualChanges.filter((vc) => vc.variation !== added.id),
    {
      variation: added.id,
      description: added.name,
      css: sourceChange?.css ?? "",
      js: sourceChange?.js ?? "",
      domMutations: (sourceChange?.domMutations ?? []).map((m) => ({ ...m })),
    },
  ];

  await updateVisualChangeset({
    visualChangeset: current,
    owner,
    context,
    updates: { visualChanges: nextVisualChanges },
  });
  await auditLiveEdit();

  // Re-read so the response matches the initial-load shape (variation
  // IDs under `variationId` rather than the internal `id`).
  const refreshedChangeset = await findVisualChangesetById(
    visualChangesetId,
    req.organization.id,
  );
  const apiExperiment = await owner.toEditorExperiment();
  if (!apiExperiment) {
    throw new Error("Experiment vanished between write and re-read");
  }

  return {
    visualChangeset: refreshedChangeset
      ? toVisualChangesetApiInterface(refreshedChangeset)
      : null,
    experiment: apiExperiment,
    newVariationId: added.id,
  };
});
