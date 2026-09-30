import { z } from "zod";
import { findVisualChangesetById } from "back-end/src/models/VisualChangesetModel";
import { createApiRequestHandler } from "back-end/src/util/handler";
import {
  ownerNotFoundMessage,
  resolveChangesetOwner,
} from "back-end/src/services/changesetOwner";
import { requireUserAuth } from "./requireUserAuth";

const bodySchema = z
  .object({
    visualChangesetId: z.string(),
    variationId: z.string(),
    name: z.string().trim().min(1).max(120),
  })
  .strict();

const validation = {
  bodySchema,
  querySchema: z.never(),
  paramsSchema: z.never(),
  responseSchema: z.any(),
  method: "post" as const,
  path: "/visual-editor/rename-variant",
  operationId: "postVisualEditorRenameVariant",
  // Internal Visual Editor extension endpoint — not part of the
  // public OpenAPI spec.
  excludeFromSpec: true,
};

export const postRenameVariant = createApiRequestHandler(validation)(async (
  req,
) => {
  const { visualChangesetId, variationId, name } = req.body;
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

  if (!owner.canUpdateOwner()) {
    context.permissions.throwPermissionError();
  }
  const auditLiveEdit = owner.requireWrite(req, {
    allowRunning: false,
    visualChangesetId,
  });

  let renamed: string;
  try {
    renamed = await owner.renameVariation(variationId, name);
  } catch (e) {
    return context.throwBadRequestError(
      e instanceof Error ? e.message : String(e),
    );
  }
  await auditLiveEdit();

  return { variationId, name: renamed };
});
