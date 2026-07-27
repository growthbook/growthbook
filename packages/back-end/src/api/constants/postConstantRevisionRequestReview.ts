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

  // Snapshot the deferred-publish guard fingerprints when arming auto-publish, so
  // the later auto-publish-on-approval fire can clear the armed guards. Throws
  // (bypassably) on unacknowledged live conflicts. Routed through the adapter so
  // every guard (experiment / config-lock / schema-break) is captured uniformly.
  const armAcknowledgments = enableAutoPublish
    ? await getAdapter("constant").captureArmAcknowledgment?.(
        req.context,
        constant as unknown as Record<string, unknown>,
        revision.target.proposedChanges,
      )
    : undefined;

  const updated = await req.context.models.revisions.submitForReview(
    revision.id,
    req.context.userId,
    {
      autoPublishOnApproval: enableAutoPublish,
      armAcknowledgments,
    },
  );

  await dispatchConstantRevisionEvent(req.context, updated, {
    type: "reviewRequested",
  });

  return { revision: await toApiConstantRevision(updated, req.context) };
});
