import { postConstantRevisionRequestReviewValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { getAdapter } from "back-end/src/revisions";
import { canEnableAutoPublishOnApproval } from "back-end/src/revisions/revisionActions";
import { dispatchConstantRevisionEvent } from "back-end/src/services/constantRevisionEvents";
import { loadRevisionByVersion } from "./validations";
import { toApiConstantRevision } from "./toApiConstantRevision";

export const postConstantRevisionRequestReview = createApiRequestHandler(
  postConstantRevisionRequestReviewValidator,
)(async (req) => {
  const constant = await req.context.models.constants.getById(
    req.params.constantId,
  );
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

  // Allow re-submitting a changes-requested revision (→ pending-review).
  if (revision.status !== "draft" && revision.status !== "changes-requested") {
    throw new BadRequestError(
      `Can only request review on a draft or changes-requested revision (status is "${revision.status}")`,
    );
  }

  const enableAutoPublish =
    req.body.autoPublishOnApproval &&
    canEnableAutoPublishOnApproval(
      req.context,
      "constant",
      constant as unknown as Record<string, unknown>,
    );

  const updated = await req.context.models.revisions.submitForReview(
    revision.id,
    req.context.userId,
    { autoPublishOnApproval: enableAutoPublish },
  );

  await dispatchConstantRevisionEvent(req.context, updated, {
    type: "reviewRequested",
  });

  return { revision: await toApiConstantRevision(updated, req.context) };
});
