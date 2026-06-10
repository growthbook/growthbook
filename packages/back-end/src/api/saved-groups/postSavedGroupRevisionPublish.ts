import { postSavedGroupRevisionPublishValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { getAdapter } from "back-end/src/revisions";
import { publishRevision } from "back-end/src/revisions/revisionActions";
import { loadRevisionByVersion } from "./validations";
import { toApiSavedGroupRevision } from "./toApiSavedGroupRevision";

export const postSavedGroupRevisionPublish = createApiRequestHandler(
  postSavedGroupRevisionPublishValidator,
)(async (req) => {
  const savedGroup = await req.context.models.savedGroups.getById(
    req.params.savedGroupId,
  );
  if (!savedGroup) {
    throw new NotFoundError("Could not find saved group");
  }

  const revision = await loadRevisionByVersion(
    req.context,
    savedGroup.id,
    req.params.version,
  );

  if (revision.status === "merged" || revision.status === "discarded") {
    throw new BadRequestError(
      `Cannot publish a revision with status "${revision.status}"`,
    );
  }

  const adapter = getAdapter("saved-group");

  // Re-check edit permission against the LIVE entity (not just the snapshot).
  // A `projects` move encoded in the proposed changes shouldn't be able to
  // launder write access — the caller still needs `canUpdateSavedGroup` on
  // the existing entity, plus the bypass permission below if review is open.
  if (!adapter.canUpdate(req.context, savedGroup as Record<string, unknown>)) {
    req.context.permissions.throwPermissionError();
  }

  // Per-revision approval gate: saved-group adapter has a metadata-only
  // shortcut, so honour `isApprovalRequiredForRevision` when available.
  const approvalRequired = adapter.isApprovalRequiredForRevision
    ? adapter.isApprovalRequiredForRevision(req.context, revision)
    : adapter.isApprovalRequired(req.context);

  // Bypass via either the org-wide `restApiBypassesReviews` flag or per-user
  // bypass permission. Mirrors postFeatureRevisionPublish.ts.
  const canBypass =
    !!req.organization.settings?.restApiBypassesReviews ||
    adapter.canBypassApproval(
      req.context,
      savedGroup as Record<string, unknown>,
    );

  if (approvalRequired && revision.status !== "approved" && !canBypass) {
    throw new BadRequestError(
      `This revision requires approval before publishing (status: "${revision.status}"). ` +
        "Enable 'REST API always bypasses approval requirements' in organization settings, " +
        "or use a role/token that grants bypassApprovalChecks on this saved group's projects.",
    );
  }

  const isBypass = approvalRequired && revision.status !== "approved";

  const merged = await publishRevision(
    req.context,
    revision,
    savedGroup as unknown as Record<string, unknown>,
    { bypass: isBypass },
  );

  return {
    revision: await toApiSavedGroupRevision(merged, req.context),
  };
});
