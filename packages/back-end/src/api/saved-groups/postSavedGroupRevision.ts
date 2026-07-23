import { postSavedGroupRevisionValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { NotFoundError } from "back-end/src/util/errors";
import {
  createOrUpdateRevision,
  ensureLiveRevisionExists,
} from "back-end/src/revisions/util";
import { dispatchSavedGroupRevisionEvent } from "back-end/src/services/savedGroupRevisionEvents";
import { toApiSavedGroupRevision } from "./toApiSavedGroupRevision";

export const postSavedGroupRevision = createApiRequestHandler(
  postSavedGroupRevisionValidator,
)(async (req) => {
  const savedGroup = await req.context.models.savedGroups.getById(
    req.params.savedGroupId,
  );
  if (!savedGroup) {
    throw new NotFoundError("Could not find saved group");
  }

  // Permission check delegates to canUpdate so it tracks the same edit gate
  // as every other write path on this entity.
  if (
    !req.context.permissions.canRevisionAction(
      "saved-group",
      "draft",
      savedGroup,
    )
  ) {
    req.context.permissions.throwPermissionError();
  }

  await ensureLiveRevisionExists(
    req.context,
    "saved-group",
    savedGroup as unknown as Record<string, unknown> & {
      id: string;
      owner?: string;
      dateCreated?: Date;
    },
  );

  // forceCreate=true: every POST should produce a fresh draft. Otherwise the
  // helper would alias an existing open draft from the same author and the
  // caller's `title` / `comment` would be silently dropped.
  const revision = await createOrUpdateRevision(
    req.context,
    "saved-group",
    savedGroup as unknown as Record<string, unknown> & { id: string },
    [],
    {
      forceCreate: true,
      title: req.body.title,
      comment: req.body.comment,
    },
  );

  await dispatchSavedGroupRevisionEvent(req.context, revision, {
    type: "created",
  });

  return {
    revision: await toApiSavedGroupRevision(revision, req.context),
  };
});
