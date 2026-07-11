import { postConfigRevisionRequestReviewValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { getAdapter } from "back-end/src/revisions";
import { canEnableAutoPublishOnApproval } from "back-end/src/revisions/revisionActions";
import { dispatchConfigRevisionEvent } from "back-end/src/services/configRevisionEvents";
import { captureConfigExperimentGuardAcknowledgment } from "back-end/src/services/experimentGuard";
import { loadRevisionByVersion } from "./validations";
import { toApiConfigRevision } from "./toApiConfigRevision";

export const postConfigRevisionRequestReview = createApiRequestHandler(
  postConfigRevisionRequestReviewValidator,
)(async (req) => {
  const config = await req.context.models.configs.getByKey(req.params.key);
  if (!config) {
    throw new NotFoundError("Could not find config");
  }

  const revision = await loadRevisionByVersion(
    req.context,
    config.id,
    req.params.version,
  );

  if (
    !getAdapter("config").canUpdate(
      req.context,
      config as Record<string, unknown>,
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
      "config",
      config as unknown as Record<string, unknown>,
    );

  // Experiment guard: arming auto-publish on a guarded config with live
  // experiment conflicts requires acknowledgment (throws if not) and snapshots
  // the acknowledged keys for the merge-time recheck.
  const experimentGuardAcknowledgedKeys = enableAutoPublish
    ? await captureConfigExperimentGuardAcknowledgment(req.context, config)
    : undefined;

  const updated = await req.context.models.revisions.submitForReview(
    revision.id,
    req.context.userId,
    {
      autoPublishOnApproval: enableAutoPublish,
      experimentGuardAcknowledgedKeys,
    },
  );

  await dispatchConfigRevisionEvent(req.context, updated, {
    type: "reviewRequested",
  });

  return { revision: await toApiConfigRevision(updated, req.context) };
});
