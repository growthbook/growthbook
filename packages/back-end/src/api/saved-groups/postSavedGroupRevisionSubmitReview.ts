import { isUserBlockedFromApproving } from "shared/enterprise";
import { postSavedGroupRevisionSubmitReviewValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { getAdapter } from "back-end/src/revisions";
import { maybeAutoPublishRevision } from "back-end/src/revisions/revisionActions";
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

  // `request-changes` by the author doesn't make sense. Author may approve
  // their own revision and may always comment.
  if (
    revision.authorId === req.context.userId &&
    decision === "request-changes"
  ) {
    throw new BadRequestError("Cannot submit a review on a draft you created");
  }

  // Block self-approval when `blockSelfApproval` is set. The shared helper
  // checks both the author and contributors against the org setting, so when
  // the setting is off, self-approval is allowed.
  if (decision === "approve") {
    const blocked = isUserBlockedFromApproving({
      settings: req.context.org.settings,
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

  if (decision === "approve" && !req.body.skipAutoPublish) {
    const entity = savedGroup as unknown as Record<string, unknown>;
    const afterAutoPublish = await maybeAutoPublishRevision(
      req.context,
      updated,
      entity,
    );
    const didAutoPublish = afterAutoPublish.status === "merged";
    return {
      revision: await toApiSavedGroupRevision(afterAutoPublish, req.context),
      autoPublished: didAutoPublish,
    };
  }

  return {
    revision: await toApiSavedGroupRevision(updated, req.context),
    autoPublished: false,
  };
});
