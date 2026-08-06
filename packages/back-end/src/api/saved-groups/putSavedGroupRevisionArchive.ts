import { putSavedGroupRevisionArchiveValidator } from "shared/validators";
import {
  canStageArchiveDraft,
  canWriteArchiveIntoDraft,
} from "back-end/src/revisions/landAuthority";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import {
  buildPatchOps,
  createOrUpdateRevision,
  ensureLiveRevisionExists,
} from "back-end/src/revisions/util";
import { dispatchSavedGroupRevisionEvent } from "back-end/src/services/savedGroupRevisionEvents";
import { assertSavedGroupArchiveDependentsGuard } from "back-end/src/services/archiveDependentsGuard";
import {
  discardIfJustCreated,
  isDraftStatus,
  pickNewDraftMetadata,
  resolveOrCreateRevision,
} from "./validations";
import { toApiSavedGroupRevision } from "./toApiSavedGroupRevision";

export const putSavedGroupRevisionArchive = createApiRequestHandler(
  putSavedGroupRevisionArchiveValidator,
)(async (req) => {
  const savedGroup = await req.context.models.savedGroups.getById(
    req.params.savedGroupId,
  );
  if (!savedGroup) {
    throw new NotFoundError("Could not find saved group");
  }

  if (
    !canStageArchiveDraft({
      permissions: req.context.permissions,
      model: "saved-group",
      entity: savedGroup,
    })
  ) {
    req.context.permissions.throwPermissionError();
  }

  const { archived } = req.body;

  // Soft-warn (bypassably) when staging an archive while the saved group is
  // still referenced. Unarchiving is always allowed.
  if (archived && !savedGroup.archived) {
    await assertSavedGroupArchiveDependentsGuard(
      req.context,
      { id: savedGroup.id },
      { armed: false },
    );
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

  const { revision, created } = await resolveOrCreateRevision(
    req.context,
    savedGroup,
    req.params.version,
    pickNewDraftMetadata(req.body),
  );

  try {
    // A pinned EXISTING draft is someone else's work: writing `archived` into
    // it makes it delete-class, which would lock its author out of publishing
    // their own draft. The delete atom stages a NEW archive draft, not a
    // reach into one it does not own.
    if (
      !created &&
      !canWriteArchiveIntoDraft({
        permissions: req.context.permissions,
        model: "saved-group",
        entity: savedGroup,
        revision,
        userId: req.context.userId,
      })
    ) {
      req.context.permissions.throwPermissionError();
    }
    if (!isDraftStatus(revision.status)) {
      throw new BadRequestError(
        `Cannot edit a revision with status "${revision.status}"`,
      );
    }

    const patchOps = buildPatchOps({ archived });

    const updated = await createOrUpdateRevision(
      req.context,
      "saved-group",
      savedGroup as unknown as Record<string, unknown> & { id: string },
      patchOps,
      { revisionId: revision.id },
    );

    if (created) {
      await dispatchSavedGroupRevisionEvent(req.context, updated, {
        type: "created",
      });
    } else {
      await dispatchSavedGroupRevisionEvent(req.context, updated, {
        type: "updated",
        change: "archive",
      });
    }

    return {
      revision: await toApiSavedGroupRevision(updated, req.context),
    };
  } catch (err) {
    await discardIfJustCreated(req.context, revision, created);
    throw err;
  }
});
