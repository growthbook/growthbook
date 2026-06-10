import { postSavedGroupRevisionSubmitReviewValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { getAdapter } from "back-end/src/revisions";
import {
  approveRevision,
  maybeAutoPublishRevision,
} from "back-end/src/revisions/revisionActions";
import { dispatchSavedGroupRevisionEvent } from "back-end/src/services/savedGroupRevisionEvents";
import { loadRevisionByVersion } from "./validations";
import { toApiSavedGroupRevision } from "./toApiSavedGroupRevision";

export const postSavedGroupRevisionSubmitReview = createApiRequestHandler(
  postSavedGroupRevisionSubmitReviewValidator,
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

  const { decision, comment } = req.body;

  if (decision === "approve") {
    const approved = await approveRevision(
      req.context,
      revision,
      savedGroup as Record<string, unknown>,
      comment ?? "",
    );

    const finalRevision = await maybeAutoPublishRevision(
      req.context,
      approved,
      savedGroup as Record<string, unknown>,
    );

    return {
      revision: await toApiSavedGroupRevision(finalRevision, req.context),
    };
  }

  if (
    !getAdapter("saved-group").canUpdate(
      req.context,
      savedGroup as Record<string, unknown>,
    )
  ) {
    req.context.permissions.throwPermissionError();
  }

  // Block the author from any non-comment review action.
  if (revision.authorId === req.context.userId && decision !== "comment") {
    throw new BadRequestError("Cannot submit a review on a draft you created");
  }

  if (
    decision !== "comment" &&
    !["pending-review", "changes-requested", "approved"].includes(
      revision.status,
    )
  ) {
    throw new BadRequestError(
      `Can only submit a review when review has been requested (status is "${revision.status}")`,
    );
  }

  const updated = await req.context.models.revisions.addReview(
    revision.id,
    req.context.userId,
    decision,
    comment ?? "",
  );

  await dispatchSavedGroupRevisionEvent(req.context, updated, {
    type: "reviewed",
    decision,
    userId: req.context.userId,
    ...(comment ? { comment } : {}),
  });

  return {
    revision: await toApiSavedGroupRevision(updated, req.context),
  };
});
