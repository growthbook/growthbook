import { postConstantRevisionUndoReviewValidator } from "shared/validators";
import { undoRevisionReview } from "back-end/src/revisions/revisionLifecycle";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { NotFoundError } from "back-end/src/util/errors";
import { loadRevisionByVersion } from "./validations";
import { toApiConstantRevision } from "./toApiConstantRevision";

export const postConstantRevisionUndoReview = createApiRequestHandler(
  postConstantRevisionUndoReviewValidator,
)(async (req) => {
  const constant = await req.context.models.constants.getByKey(req.params.key);
  if (!constant) {
    throw new NotFoundError("Could not find Constant");
  }

  const revision = await loadRevisionByVersion(
    req.context,
    constant.id,
    req.params.version,
  );

  const updated = await undoRevisionReview({
    context: req.context,
    type: "constant",
    entity: constant as unknown as Record<string, unknown>,
    revision,
  });

  return { revision: await toApiConstantRevision(updated, req.context) };
});
