import { isUserBlockedFromApproving } from "shared/enterprise";
import { postSavedGroupRevisionSubmitReviewValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { getAdapter } from "back-end/src/revisions";
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

  // Anyone with edit permission can comment / request-changes; the
  // self-approve guard below blocks `approve` decisions.
  if (
    !getAdapter("saved-group").canUpdate(
      req.context,
      savedGroup as Record<string, unknown>,
    )
  ) {
    req.context.permissions.throwPermissionError();
  }

  const { decision, comment } = req.body;

  // Block the author from any non-comment review action.
  if (revision.authorId === req.context.userId && decision !== "comment") {
    throw new BadRequestError("Cannot submit a review on a draft you created");
  }

  // Block contributor self-approve when `blockSelfApproval` is set. Same
  // rule the internal /revision/:id/review endpoint enforces — using the
  // shared helper keeps the logic in lockstep.
  if (decision === "approve") {
    const blocked = isUserBlockedFromApproving({
      approvalFlows: req.context.org.settings?.approvalFlows,
      entityType: "saved-group",
      revision,
      userId: req.context.userId,
    });
    if (blocked) {
      throw new BadRequestError(
        "You cannot approve a draft you contributed to.",
      );
    }
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
