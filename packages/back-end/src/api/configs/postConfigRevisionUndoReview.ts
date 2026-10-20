import { postConfigRevisionUndoReviewValidator } from "shared/validators";
import { undoRevisionReview } from "back-end/src/revisions/revisionLifecycle";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { NotFoundError } from "back-end/src/util/errors";
import { loadRevisionByVersion } from "./validations";
import { toApiConfigRevision } from "./toApiConfigRevision";

export const postConfigRevisionUndoReview = createApiRequestHandler(
  postConfigRevisionUndoReviewValidator,
)(async (req) => {
  const config = await req.context.models.configs.getByKey(req.params.key);
  if (!config) {
    throw new NotFoundError("Could not find Config");
  }

  const revision = await loadRevisionByVersion(
    req.context,
    config.id,
    req.params.version,
  );

  const updated = await undoRevisionReview({
    context: req.context,
    type: "config",
    entity: config as unknown as Record<string, unknown>,
    revision,
  });

  return { revision: await toApiConfigRevision(updated, req.context) };
});
