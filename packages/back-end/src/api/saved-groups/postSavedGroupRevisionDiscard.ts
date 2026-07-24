import { postSavedGroupRevisionDiscardValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { getAdapter } from "back-end/src/revisions";
import { dispatchSavedGroupRevisionEvent } from "back-end/src/services/savedGroupRevisionEvents";
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

  if (revision.status === "merged" || revision.status === "discarded") {
    throw new BadRequestError(
      `Cannot discard a revision with status "${revision.status}"`,
    );
  }

  // Authors can always discard their own drafts. For everyone else we
  // delegate to the adapter's canUpdate, mirroring the internal /revision
  // controller's close handler — same permission semantics, same code path.
  if (revision.authorId !== req.context.userId) {
    if (
      !getAdapter("saved-group").canUpdate(
        req.context,
        savedGroup as Record<string, unknown>,
      )
    ) {
      req.context.permissions.throwPermissionError();
    }
  }

  const closed = await req.context.models.revisions.close(
    revision.id,
    req.context.userId,
    req.body.reason,
  );

  await dispatchSavedGroupRevisionEvent(req.context, closed, {
    type: "discarded",
  });

  return {
    revision: await toApiSavedGroupRevision(closed, req.context),
  };
});
