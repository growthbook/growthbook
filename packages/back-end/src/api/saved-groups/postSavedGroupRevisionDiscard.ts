import { postSavedGroupRevisionDiscardValidator } from "shared/validators";
import { discardEntityRevision } from "back-end/src/revisions/revisionActions";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { NotFoundError } from "back-end/src/util/errors";
import { loadRevisionByVersion } from "./validations";
import { toApiSavedGroupRevision } from "./toApiSavedGroupRevision";

export const postSavedGroupRevisionDiscard = createApiRequestHandler(
  postSavedGroupRevisionDiscardValidator,
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

  const closed = await discardEntityRevision({
    context: req.context,
    entityType: "saved-group",
    revision,
    reason: req.body.reason,
  });

  return {
    revision: await toApiSavedGroupRevision(closed, req.context),
  };
});
