import { postSavedGroupRevisionRebaseValidator } from "shared/validators";
import { rebaseRevision } from "back-end/src/revisions/revisionActions";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { NotFoundError } from "back-end/src/util/errors";
import { loadRevisionByVersion } from "./validations";
import { toApiSavedGroupRevision } from "./toApiSavedGroupRevision";

export const postSavedGroupRevisionRebase = createApiRequestHandler(
  postSavedGroupRevisionRebaseValidator,
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

  const updated = await rebaseRevision({
    context: req.context,
    entityType: "saved-group",
    entity: savedGroup as unknown as Record<string, unknown>,
    revision,
    strategies: req.body.conflictResolutions ?? {},
    customValues: req.body.customValues,
  });

  return { revision: await toApiSavedGroupRevision(updated, req.context) };
});
