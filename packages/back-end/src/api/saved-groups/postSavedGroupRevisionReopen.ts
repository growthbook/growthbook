import { postSavedGroupRevisionReopenValidator } from "shared/validators";
import { reopenRevision } from "back-end/src/revisions/revisionLifecycle";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { NotFoundError } from "back-end/src/util/errors";
import { loadRevisionByVersion } from "./validations";
import { toApiSavedGroupRevision } from "./toApiSavedGroupRevision";

export const postSavedGroupRevisionReopen = createApiRequestHandler(
  postSavedGroupRevisionReopenValidator,
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

  const reopened = await reopenRevision({
    context: req.context,
    type: "saved-group",
    revision,
  });

  return { revision: await toApiSavedGroupRevision(reopened, req.context) };
});
