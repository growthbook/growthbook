import { z } from "zod";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { loadChangesetWithOwner } from "back-end/src/api/visual-editor-ai/loadChangesetWithOwner";
import { requireUserAuth } from "./requireUserAuth";

// Renames only the display `name` — tracking key is intentionally left
// alone so SDK analytics don't silently break. Tracking-key edits go
// through the full GrowthBook web app.
const bodySchema = z
  .object({
    visualChangesetId: z.string(),
    name: z.string().min(1).max(200),
  })
  .strict();

const validation = {
  bodySchema,
  querySchema: z.never(),
  paramsSchema: z.never(),
  responseSchema: z.any(),
  method: "post" as const,
  path: "/visual-editor/rename-experiment",
  operationId: "postVisualEditorRenameExperiment",
  // Internal Visual Editor extension endpoint — not part of the
  // public OpenAPI spec.
  excludeFromSpec: true,
};

export const postRenameExperiment = createApiRequestHandler(validation)(async (
  req,
) => {
  const { visualChangesetId, name } = req.body;
  const context = req.context;
  requireUserAuth(context);

  const { owner } = await loadChangesetWithOwner(context, visualChangesetId);

  // Rename lives on the owner, not the changeset, so gate on the
  // owner's update permission (not canUpdateVisualChange).
  if (!owner.canUpdateOwner()) {
    context.permissions.throwPermissionError();
  }

  // Skip the write when unchanged to avoid spurious dateUpdated bumps
  // (which would invalidate SDK payload caches).
  const renamed = await owner.rename(name);
  return { name: renamed };
});
