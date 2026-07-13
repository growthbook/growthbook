import { postConstantRevisionRequestReviewValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { getAdapter } from "back-end/src/revisions";
import { canEnableAutoPublishOnApproval } from "back-end/src/revisions/revisionActions";
import { dispatchConstantRevisionEvent } from "back-end/src/services/constantRevisionEvents";
import { captureConstantExperimentGuardAcknowledgment } from "back-end/src/services/experimentGuard";
import { loadRevisionByVersion } from "./validations";
import { toApiConstantRevision } from "./toApiConstantRevision";

export const postConstantRevisionRequestReview = createApiRequestHandler(
  postConstantRevisionRequestReviewValidator,
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

  // Experiment guard: snapshot the acknowledged conflict keys when arming
  // auto-publish (throws if arming over live conflicts without ignoreWarnings/
  // bypass). Without this, a later auto-publish-on-approval fire would hit the
  // adapter's armed guard with no acknowledgment and terminally fail. Mirrors
  // the config request-review handler.
  const experimentGuardAcknowledgedKeys = enableAutoPublish
    ? await captureConstantExperimentGuardAcknowledgment(
        req.context,
        constant,
        revision.target.proposedChanges,
      )
    : undefined;

  const updated = await req.context.models.revisions.submitForReview(
    revision.id,
    req.context.userId,
    {
      autoPublishOnApproval: enableAutoPublish,
      experimentGuardAcknowledgedKeys,
    },
  );

  await dispatchConstantRevisionEvent(req.context, updated, {
    type: "reviewRequested",
  });

  return { revision: await toApiConstantRevision(updated, req.context) };
});
