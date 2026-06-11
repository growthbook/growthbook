import { postSavedGroupRevisionApproveAndPublishValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { NotFoundError } from "back-end/src/util/errors";
import {
  approveRevision,
  publishRevision,
} from "back-end/src/revisions/revisionActions";
import { loadRevisionByVersion } from "./validations";
import { toApiSavedGroupRevision } from "./toApiSavedGroupRevision";

export const postSavedGroupRevisionApproveAndPublish = createApiRequestHandler(
  postSavedGroupRevisionApproveAndPublishValidator,
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

  const entity = savedGroup as unknown as Record<string, unknown>;

  const approved = await approveRevision(
    req.context,
    revision,
    entity,
    req.body.comment,
  );

  const merged = await publishRevision(req.context, approved, entity);

  return {
    revision: await toApiSavedGroupRevision(merged, req.context),
  };
});
