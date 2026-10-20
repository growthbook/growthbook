import { postSavedGroupRevisionUndoReviewValidator } from "shared/validators";
import { undoRevisionReview } from "back-end/src/revisions/revisionLifecycle";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { NotFoundError } from "back-end/src/util/errors";
import { loadRevisionByVersion } from "./validations";
import { toApiSavedGroupRevision } from "./toApiSavedGroupRevision";

export const postSavedGroupRevisionUndoReview = createApiRequestHandler(
  postSavedGroupRevisionUndoReviewValidator,
)(async (req) => {
  const savedGroup = await req.context.models.savedGroups.getById(
    req.params.savedGroupId,
  );
  if (!savedGroup) {
    throw new NotFoundError("Could not find Saved Group");
  }

  const revision = await loadRevisionByVersion(
    req.context,
    savedGroup.id,
    req.params.version,
  );

  const updated = await undoRevisionReview({
    context: req.context,
    type: "saved-group",
    entity: savedGroup as unknown as Record<string, unknown>,
    revision,
  });

  return { revision: await toApiSavedGroupRevision(updated, req.context) };
});
