import { z } from "zod";
import { findVisualChangesetById } from "back-end/src/models/VisualChangesetModel";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { promoteFile } from "back-end/src/services/files";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { requireUserAuth } from "./requireUserAuth";

// "Promote" moves an AI-generated image out of the throwaway `gen/`
// quarantine prefix into its permanent location. Triggered when the user
// accepts a proposed mutation whose source URL points at a gen file.
//
// The contract: the caller passes the gen-prefixed key (NOT the public
// URL — that may have been rewritten by a CDN). The endpoint validates
// the key is under the caller's own org's gen prefix and that they have
// write access to the named changeset, then S3-copies the object to its
// permanent location and deletes the gen original. Anything left behind
// in the gen prefix is reaped by the bucket's lifecycle policy.

const bodySchema = z
  .object({
    // Required so we can gate promotion on the same permission used for
    // every other write in this surface. Without it a read-only collaborator
    // could shuffle files around inside their org's bucket.
    visualChangesetId: z.string(),
    // The full storage key, including the `gen/<orgId>/visual-editor/`
    // prefix. We compute the destination key by stripping the leading
    // `gen/` component — promotion is a within-bucket move, not a
    // cross-bucket rewrite.
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
};

export const postPromoteImage = createApiRequestHandler(validation)(async (
  req,
) => {
  const { visualChangesetId, filePath } = req.body;
  const org = req.organization;
  const context = req.context;
  // Require PAT auth — moves files in the org bucket; we want the
  // operation attributable to a real user even though the audit log
  // here is light.
  requireUserAuth(context);

  // Watch out for poison null bytes — defense in depth; promoteFile
  // also checks but we'd rather reject early with a clean error.
  if (filePath.indexOf("\0") !== -1) {
    throw new Error("filePath must not contain null bytes");
  }

  // Path-traversal defense: the key must match the exact gen prefix
  // pattern. Without this a malicious caller could pass
  // `gen/<their-org>/../<other-org>/...` or `gen/<other-org>/...` and
  // promote / delete files outside their own scope. We require the key
  // to start with `gen/<callerOrgId>/visual-editor/` and contain no
  // `..` segments. The trailing filename can be anything (UUIDs were
  // assigned at upload time by us).
  const expectedPrefix = `gen/${org.id}/visual-editor/`;
  if (!filePath.startsWith(expectedPrefix)) {
    throw new Error(
      "filePath must reference a file in your organization's gen prefix",
    );
  }
  // Reject any `..` segments to be extra safe — even though they
  // wouldn't pass the prefix check above, this catches subtle cases
  // (e.g. `gen/<orgId>/visual-editor/../../other`) that *technically*
  // start with the prefix string.
  if (filePath.split("/").some((seg) => seg === "..")) {
    throw new Error("filePath must not contain parent-directory segments");
  }

  // Permission gate: load the changeset to scope to the caller's org,
  // then check write access to the parent experiment.
  const changeset = await findVisualChangesetById(visualChangesetId, org.id);
  if (!changeset)
    return context.throwNotFoundError("Visual changeset not found");
  const experiment = await getExperimentById(context, changeset.experiment);
  if (!experiment) return context.throwNotFoundError("Experiment not found");
  if (!context.permissions.canUpdateVisualChange(experiment)) {
    context.permissions.throwPermissionError();
  }

  // Destination key = source key with the leading `gen/` stripped. The
  // rest of the path (`<orgId>/visual-editor/<filename>`) is exactly
  // where a direct (non-gen) upload would have landed.
  const destKey = filePath.slice("gen/".length);

  const fileUrl = await promoteFile(filePath, destKey, "visual-editor-assets");

  return {
    fileUrl,
    filePath: destKey,
  };
});
