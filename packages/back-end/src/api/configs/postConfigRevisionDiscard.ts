import { postConfigRevisionDiscardValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { dispatchConfigRevisionEvent } from "back-end/src/services/configRevisionEvents";
import { loadRevisionByVersion } from "./validations";
import { toApiConfigRevision } from "./toApiConfigRevision";

export const postConfigRevisionDiscard = createApiRequestHandler(
  postConfigRevisionDiscardValidator,
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

  if (revision.status === "merged" || revision.status === "discarded") {
    throw new BadRequestError(
      `Cannot discard a revision with status "${revision.status}"`,
    );
  }

  // Authors can always discard their own drafts; otherwise require edit perm.
  if (revision.authorId !== req.context.userId) {
    if (!req.context.permissions.canRevisionAction("config", "draft", config)) {
      req.context.permissions.throwPermissionError();
    }
  }

  const closed = await req.context.models.revisions.close(
    revision.id,
    req.context.userId,
    req.body.reason,
  );

  await dispatchConfigRevisionEvent(req.context, closed, {
    type: "discarded",
  });

  return { revision: await toApiConfigRevision(closed, req.context) };
});
