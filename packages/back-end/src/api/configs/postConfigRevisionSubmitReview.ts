import { constantBlockSelfApproval } from "shared/util";
import { postConfigRevisionSubmitReviewValidator } from "shared/validators";
import {
  canCommentOnRevision,
  maybeAutoPublishRevision,
} from "back-end/src/revisions/revisionActions";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { dispatchConfigRevisionEvent } from "back-end/src/services/configRevisionEvents";
import { loadRevisionByVersion } from "./validations";
import { toApiConfigRevision } from "./toApiConfigRevision";

export const postConfigRevisionSubmitReview = createApiRequestHandler(
  postConfigRevisionSubmitReviewValidator,
)(async (req) => {
  // Addressed by the entity's own key, so an entity the caller cannot read is a
  // 404 here even for a comment, which the internal controller — addressed by
  // revision id — would allow on the snapshot. Deliberate: closing the gap means
  // a permission-bypassing read on the key, and this direction fails closed.
  const config = await req.context.models.configs.getByKey(req.params.key);
  if (!config) {
    throw new NotFoundError("Could not find Config");
  }

  const revision = await loadRevisionByVersion(
    req.context,
    config.id,
    req.params.version,
  );

  // A verdict needs review authority; a plain comment is participation. Same
  // split the internal controller makes, via the same helper.
  if (
    !(req.body.decision === "comment"
      ? canCommentOnRevision(
          "config",
          req.context,
          // The revision's own snapshot, not the live entity: a comment belongs
          // to the revision, whose project may predate a move. Same basis the
          // internal controller uses.
          revision.target.snapshot as Record<string, unknown>,
        )
      : req.context.permissions.canRevisionAction("config", "review", config))
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
