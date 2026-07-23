import { postConstantRevisionDiscardValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { dispatchConstantRevisionEvent } from "back-end/src/services/constantRevisionEvents";
import { loadRevisionByVersion } from "./validations";
import { toApiConstantRevision } from "./toApiConstantRevision";

export const postConstantRevisionDiscard = createApiRequestHandler(
  postConstantRevisionDiscardValidator,
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

  if (revision.status === "merged" || revision.status === "discarded") {
    throw new BadRequestError(
      `Cannot discard a revision with status "${revision.status}"`,
    );
  }

  // Authors can always discard their own drafts; otherwise require edit perm.
  if (revision.authorId !== req.context.userId) {
    if (
      !req.context.permissions.canRevisionAction("constant", "draft", constant)
    ) {
      req.context.permissions.throwPermissionError();
    }
  }

  const closed = await req.context.models.revisions.close(
    revision.id,
    req.context.userId,
    req.body.reason,
  );

  await dispatchConstantRevisionEvent(req.context, closed, {
    type: "discarded",
  });

  return { revision: await toApiConstantRevision(closed, req.context) };
});
