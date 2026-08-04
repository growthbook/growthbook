import { postSavedGroupRevisionRequestReviewValidator } from "shared/validators";
import { requestRevisionReview } from "back-end/src/revisions/revisionActions";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { NotFoundError } from "back-end/src/util/errors";
import { loadRevisionByVersion } from "./validations";
import { toApiSavedGroupRevision } from "./toApiSavedGroupRevision";

export const postSavedGroupRevisionRequestReview = createApiRequestHandler(
  postSavedGroupRevisionRequestReviewValidator,
)(async (req) => {
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

  // Anyone with edit permission on the saved group can submit the draft for
  // review (matches the internal `submitForReview` controller). Saved groups
  // don't have a separate "manage drafts" permission like features do.
  const updated = await requestRevisionReview({
    context: req.context,
    entityType: "saved-group",
    entity: savedGroup as unknown as Record<string, unknown>,
    revision,
    autoPublishOnApproval: req.body.autoPublishOnApproval,
  });

  return {
    revision: await toApiSavedGroupRevision(updated, req.context),
  };
});
