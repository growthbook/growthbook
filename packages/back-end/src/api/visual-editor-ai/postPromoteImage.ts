import { z } from "zod";
import { findVisualChangesetById } from "back-end/src/models/VisualChangesetModel";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { promoteFile } from "back-end/src/services/files";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { requireUserAuth } from "./requireUserAuth";

// Moves an AI-generated image out of the throwaway `gen/` quarantine prefix
// into its permanent location when the user accepts the proposed mutation.
// Caller passes the storage key (not the public URL — CDNs may rewrite it).

const bodySchema = z
  .object({
    visualChangesetId: z.string(),
    // Full storage key including the `gen/<orgId>/visual-editor/` prefix.
    filePath: z.string(),
  })
  .strict();

const validation = {
  bodySchema,
  querySchema: z.never(),
  paramsSchema: z.never(),
  responseSchema: z.any(),
  method: "post" as const,
  path: "/visual-editor/ai/promote-image",
  operationId: "postVisualEditorAIPromoteImage",
  // Internal Visual Editor extension endpoint — not part of the
  // public OpenAPI spec.
  excludeFromSpec: true,
};

export const postPromoteImage = createApiRequestHandler(validation)(async (
  req,
) => {
  const { visualChangesetId, filePath } = req.body;
  const org = req.organization;
  const context = req.context;
  requireUserAuth(context);

  // Poison-null defense in depth; promoteFile also checks.
  if (filePath.indexOf("\0") !== -1) {
    throw new Error("filePath must not contain null bytes");
  }

  // Path-traversal defense: the key must sit under the caller's own org
  // gen prefix. Without this, a key like `gen/<their>/../<other>/...`
  // could promote/delete files in another org's scope.
  const expectedPrefix = `gen/${org.id}/visual-editor/`;
  if (!filePath.startsWith(expectedPrefix)) {
    throw new Error(
      "filePath must reference a file in your organization's gen prefix",
    );
  }
  // Catches `..` segments that technically start with the expected prefix
  // (e.g. `gen/<orgId>/visual-editor/../../other`).
  if (filePath.split("/").some((seg) => seg === "..")) {
    throw new Error("filePath must not contain parent-directory segments");
  }

  const changeset = await findVisualChangesetById(visualChangesetId, org.id);
  if (!changeset)
    return context.throwNotFoundError("Visual changeset not found");
  const experiment = await getExperimentById(context, changeset.experiment);
  if (!experiment) return context.throwNotFoundError("Experiment not found");
  if (!context.permissions.canUpdateVisualChange(experiment)) {
    context.permissions.throwPermissionError();
  }

  // Destination = source key minus the leading `gen/`.
  const destKey = filePath.slice("gen/".length);

  const fileUrl = await promoteFile(filePath, destKey, "visual-editor-assets");

  return {
    fileUrl,
    filePath: destKey,
  };
});
