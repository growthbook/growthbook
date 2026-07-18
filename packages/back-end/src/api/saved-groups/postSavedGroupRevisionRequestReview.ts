import { postSavedGroupRevisionRequestReviewValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { getAdapter } from "back-end/src/revisions";
import { canEnableAutoPublishOnApproval } from "back-end/src/revisions/revisionActions";
import { dispatchSavedGroupRevisionEvent } from "back-end/src/services/savedGroupRevisionEvents";
import { loadRevisionByVersion } from "./validations";
import { toApiSavedGroupRevision } from "./toApiSavedGroupRevision";

export const postSavedGroupRevisionRequestReview = createApiRequestHandler(
  postSavedGroupRevisionRequestReviewValidator,
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

  // Anyone with edit permission on the saved group can submit the draft for
  // review (matches the internal `submitForReview` controller). Saved groups
  // don't have a separate "manage drafts" permission like features do.
  if (
    !getAdapter("saved-group").canUpdate(
      req.context,
      savedGroup as Record<string, unknown>,
    )
  ) {
    req.context.permissions.throwPermissionError();
  }

  // Allow both `draft` and `changes-requested` so an author can re-submit a
  // revision after a reviewer requested changes (changes-requested →
  // pending-review). Without this, a changes-requested revision is stuck.
  if (revision.status !== "draft" && revision.status !== "changes-requested") {
    throw new BadRequestError(
      `Can only request review on a draft or changes-requested revision (status is "${revision.status}")`,
    );
  }

  const enableAutoPublish =
    req.body.autoPublishOnApproval &&
    canEnableAutoPublishOnApproval(
      req.context,
      "saved-group",
      savedGroup as unknown as Record<string, unknown>,
    );

  const updated = await req.context.models.revisions.submitForReview(
    revision.id,
    req.context.userId,
    { autoPublishOnApproval: enableAutoPublish },
  );

  await dispatchSavedGroupRevisionEvent(req.context, updated, {
    type: "reviewRequested",
  });

  return {
    revision: await toApiSavedGroupRevision(updated, req.context),
  };
});
