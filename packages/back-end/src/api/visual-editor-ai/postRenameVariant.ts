import { z } from "zod";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { loadChangesetWithOwner } from "back-end/src/api/visual-editor-ai/loadChangesetWithOwner";
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

  const { owner } = await loadChangesetWithOwner(context, visualChangesetId);

  if (!owner.canUpdateOwner()) {
    context.permissions.throwPermissionError();
  }
  const auditLiveEdit = owner.requireWrite(req, {
    allowRunning: false,
    visualChangesetId,
  });

  const renamed = await owner.renameVariation(variationId, name);
  await auditLiveEdit();

  return { variationId, name: renamed };
});
