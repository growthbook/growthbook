import { constantBlockSelfApproval } from "shared/util";
import { postConfigRevisionSubmitReviewValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import {
  callerCanRevisionAction,
  maybeAutoPublishRevision,
} from "back-end/src/revisions/revisionActions";
import { dispatchConfigRevisionEvent } from "back-end/src/services/configRevisionEvents";
import { loadRevisionByVersion } from "./validations";
import { toApiConfigRevision } from "./toApiConfigRevision";

export const postConfigRevisionSubmitReview = createApiRequestHandler(
  postConfigRevisionSubmitReviewValidator,
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
    !callerCanRevisionAction(
      req.context,
      "config",
      "review",
      config as Record<string, unknown>,
    )
  ) {
    req.context.permissions.throwPermissionError();
  }

  const { decision, comment } = req.body;

  // Block the author from any non-comment review action.
  if (revision.authorId === req.context.userId && decision !== "comment") {
    throw new BadRequestError("Cannot submit a review on a draft you created");
  }

  // Block contributor self-approve when `blockSelfApproval` is set.
  if (
    decision === "approve" &&
    constantBlockSelfApproval(
      { project: config.project },
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

  await dispatchConfigRevisionEvent(req.context, updated, {
    type: "reviewed",
    decision,
    userId: req.context.userId,
    ...(comment ? { comment } : {}),
  });

  if (decision === "approve" && !req.body.skipAutoPublish) {
    const afterAutoPublish = await maybeAutoPublishRevision(
      req.context,
      updated,
      config as unknown as Record<string, unknown>,
    );
    return {
      revision: await toApiConfigRevision(afterAutoPublish, req.context),
      autoPublished: afterAutoPublish.status === "merged",
    };
  }

  return {
    revision: await toApiConfigRevision(updated, req.context),
    autoPublished: false,
  };
});
