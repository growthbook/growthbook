import { z } from "zod";
import {
  findVisualChangesetById,
  toVisualChangesetApiInterface,
  updateVisualChangeset,
} from "back-end/src/models/VisualChangesetModel";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { logger } from "back-end/src/util/logger";
import {
  ownerNotFoundMessage,
  resolveChangesetOwner,
} from "back-end/src/services/changesetOwner";
import { requireUserAuth } from "./requireUserAuth";

const bodySchema = z
  .object({
    visualChangesetId: z.string(),
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

// Removes a variation from the owner and its visualChange from the
// changeset. The owner write lands first and is rolled back if the
// changeset write fails.
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

  const owner = await resolveChangesetOwner(context, changeset);
  if (!owner)
    return context.throwNotFoundError(ownerNotFoundMessage(changeset));

  if (!owner.canManageVariations()) {
    context.permissions.throwPermissionError();
  }
  const auditLiveEdit = owner.requireWrite(req, {
    allowRunning: false,
    visualChangesetId,
  });

  let removed: { rollback?: () => Promise<void> };
  try {
    removed = await owner.removeVariation(variationId);
  } catch (e) {
    return context.throwBadRequestError(
      e instanceof Error ? e.message : String(e),
    );
  }

  // Build from a fresh read: the owner write may already have dropped the
  // entry from this changeset (contextual bandits sync on removal).
  const current =
    (await findVisualChangesetById(visualChangesetId, req.organization.id)) ??
    changeset;
  const nextVisualChanges = current.visualChanges.filter(
    (vc) => vc.variation !== variationId,
  );

  try {
    await updateVisualChangeset({
      visualChangeset: current,
      owner,
      context,
      updates: { visualChanges: nextVisualChanges },
    });
  } catch (e) {
    if (!removed.rollback) {
      logger.error(
        { err: e, variationId, visualChangesetId },
        "[visual-editor/delete-variant] visual-change write failed after an irreversible variation removal; its visual change remains",
      );
      throw e;
    }
    try {
      await removed.rollback();
    } catch (rollbackErr) {
      logger.error(
        { err: rollbackErr, variationId, visualChangesetId },
        "[visual-editor/delete-variant] rollback failed after visual-change write error; variation removed but its visual change remains",
      );
    }
    throw e;
  }
  await auditLiveEdit();

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
  };
});
