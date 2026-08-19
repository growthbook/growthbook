import { postSavedGroupRevisionSubmitReviewValidator } from "shared/validators";
import { submitRevisionReview } from "back-end/src/revisions/revisionActions";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { NotFoundError } from "back-end/src/util/errors";
import { loadRevisionByVersion } from "./validations";
import { toApiSavedGroupRevision } from "./toApiSavedGroupRevision";

export const postSavedGroupRevisionSubmitReview = createApiRequestHandler(
  postSavedGroupRevisionSubmitReviewValidator,
)(async (req) => {
  // Id-addressed REST handlers fail closed when the live entity is unreadable.
  const savedGroup = await req.context.models.savedGroups.getById(
    req.params.savedGroupId,
  );
  if (!savedGroup) {
    throw new NotFoundError("Could not find saved group");
  }

  const revision = await loadRevisionByVersion(
    req.context,
    savedGroup.id,
    req.params.version,
  );

  const { revision: result, autoPublished } = await submitRevisionReview({
    context: req.context,
    entityType: "saved-group",
    entity: savedGroup as unknown as Record<string, unknown> & {
      project?: string;
      projects?: string[];
    },
    revision,
    decision: req.body.decision,
    comment: req.body.comment,
    skipAutoPublish: req.body.skipAutoPublish,
  });

  return {
    revision: await toApiSavedGroupRevision(result, req.context),
    autoPublished,
  };
});
