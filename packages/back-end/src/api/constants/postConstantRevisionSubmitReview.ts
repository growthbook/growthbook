import { constantBlockSelfApproval } from "shared/util";
import { postConstantRevisionSubmitReviewValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { getAdapter } from "back-end/src/revisions";
import { maybeAutoPublishRevision } from "back-end/src/revisions/revisionActions";
import { dispatchConstantRevisionEvent } from "back-end/src/services/constantRevisionEvents";
import { loadRevisionByVersion } from "./validations";
import { toApiConstantRevision } from "./toApiConstantRevision";

export const postConstantRevisionSubmitReview = createApiRequestHandler(
  postConstantRevisionSubmitReviewValidator,
)(async (req) => {
  const constant = await req.context.models.constants.getByKey(req.params.key);
  if (!constant) {
    throw new NotFoundError("Could not find constant");
  }

  const revision = await loadRevisionByVersion(
    req.context,
    constant.id,
    req.params.version,
  );

  if (
    !getAdapter("constant").canUpdate(
      req.context,
      constant as Record<string, unknown>,
    )
  ) {
    req.context.permissions.throwPermissionError();
  }

  const { decision, comment } = req.body;

  // Block the author from any non-comment review action.
  if (revision.authorId === req.context.userId && decision !== "comment") {
    throw new BadRequestError("Cannot submit a review on a draft you created");
  }

  // Block contributor self-approve when `blockSelfApproval` is set. Constants
  // use the feature `requireReviews` model (matched by project), not the
  // saved-group `approvalFlows` config, so derive the gate from the matched rule
  // rather than the generic `isUserBlockedFromApproving` (which would be inert).
  if (
    decision === "approve" &&
    constantBlockSelfApproval(
      { project: constant.project },
      req.context.org.settings,
    )
  ) {
    const contributors = revision.contributors ?? [];
    if (contributors.includes(req.context.userId)) {
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

  await dispatchConstantRevisionEvent(req.context, updated, {
    type: "reviewed",
    decision,
    userId: req.context.userId,
    ...(comment ? { comment } : {}),
  });

  if (decision === "approve" && !req.body.skipAutoPublish) {
    const afterAutoPublish = await maybeAutoPublishRevision(
      req.context,
      updated,
      constant as unknown as Record<string, unknown>,
    );
    return {
      revision: await toApiConstantRevision(afterAutoPublish, req.context),
      autoPublished: afterAutoPublish.status === "merged",
    };
  }

  return {
    revision: await toApiConstantRevision(updated, req.context),
    autoPublished: false,
  };
});
