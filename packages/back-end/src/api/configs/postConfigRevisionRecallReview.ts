import { postConfigRevisionRecallReviewValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { getAdapter } from "back-end/src/revisions";
import { dispatchConfigRevisionEvent } from "back-end/src/services/configRevisionEvents";
import { loadRevisionByVersion } from "./validations";
import { toApiConfigRevision } from "./toApiConfigRevision";

export const postConfigRevisionRecallReview = createApiRequestHandler(
  postConfigRevisionRecallReviewValidator,
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
    !["pending-review", "changes-requested", "approved"].includes(
      revision.status,
    )
  ) {
    throw new BadRequestError(
      "Only a revision in review can be returned to draft",
    );
  }

  // Author can always recall; otherwise require permission to edit the config.
  if (revision.authorId !== req.context.userId) {
    if (
      !getAdapter("config").canUpdate(
        req.context,
        config as Record<string, unknown>,
      )
    ) {
      req.context.permissions.throwPermissionError();
    }
  }

  const recalled = await req.context.models.revisions.recallReview(
    revision.id,
    req.context.userId,
  );

  await dispatchConfigRevisionEvent(req.context, recalled, {
    type: "reopened",
  });

  return { revision: await toApiConfigRevision(recalled, req.context) };
});
