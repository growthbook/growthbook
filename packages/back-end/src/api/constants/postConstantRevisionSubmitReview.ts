import { isUserBlockedFromApproving } from "shared/enterprise";
import { postConstantRevisionSubmitReviewValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import {
  callerCanRevisionAction,
  maybeAutoPublishRevision,
} from "back-end/src/revisions/revisionActions";
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
    !callerCanRevisionAction(
      req.context,
      "constant",
      "review",
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

  // Block contributor self-approve when blockSelfApproval is set. The shared
  // helper routes constants through the requireReviews model — same rule the
  // internal /revision/:id/review endpoint enforces.
  if (decision === "approve") {
    const blocked = isUserBlockedFromApproving({
      settings: req.context.org.settings,
      entityType: "constant",
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
