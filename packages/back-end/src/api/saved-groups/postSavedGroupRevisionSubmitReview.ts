import { postSavedGroupRevisionSubmitReviewValidator } from "shared/validators";
import { submitRevisionReview } from "back-end/src/revisions/revisionActions";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { NotFoundError } from "back-end/src/util/errors";
import { loadRevisionByVersion } from "./validations";
import { toApiSavedGroupRevision } from "./toApiSavedGroupRevision";

export const postSavedGroupRevisionSubmitReview = createApiRequestHandler(
  postSavedGroupRevisionSubmitReviewValidator,
)(async (req) => {
  // Addressed by the entity's own id, so an entity the caller cannot read is a
  // 404 here even for a comment, which the internal controller — addressed by
  // revision id — would allow on the snapshot. Deliberate: closing the gap means
  // a permission-bypassing read, and this direction fails closed.
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

  // Anyone with edit permission can comment / request-changes; the
  // self-approve guard below blocks `approve` decisions.
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
