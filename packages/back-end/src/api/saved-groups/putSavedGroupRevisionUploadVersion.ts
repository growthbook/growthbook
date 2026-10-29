import { putSavedGroupRevisionUploadVersionValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import {
  buildPatchOps,
  createOrUpdateRevision,
  ensureLiveRevisionExists,
} from "back-end/src/revisions/util";
import { dispatchSavedGroupRevisionEvent } from "back-end/src/services/savedGroupRevisionEvents";
import { assertUsableUploadVersion } from "back-end/src/services/remoteSavedGroups";
import {
  assertRemoteGroup,
  discardIfJustCreated,
  isDraftStatus,
  pickNewDraftMetadata,
  resolveOrCreateRevision,
} from "./validations";
import { toApiSavedGroupRevision } from "./toApiSavedGroupRevision";

export const putSavedGroupRevisionUploadVersion = createApiRequestHandler(
  putSavedGroupRevisionUploadVersionValidator,
)(async (req) => {
  const savedGroup = await req.context.models.savedGroups.getById(
    req.params.savedGroupId,
  );
  if (!savedGroup) {
    throw new NotFoundError("Could not find saved group");
  }

  assertRemoteGroup(savedGroup);

  const { currentUploadVersion } = req.body;

  if (
    !req.context.permissions.canRevisionAction(
      "saved-group",
      "draft",
      savedGroup,
    )
  ) {
    req.context.permissions.throwPermissionError();
  }

  // Checked before any draft is created, so a bad version never persists
  await assertUsableUploadVersion(
    req.context,
    savedGroup.id,
    currentUploadVersion,
  );

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
    if (!isDraftStatus(revision.status)) {
      throw new BadRequestError(
        `Cannot edit a revision with status "${revision.status}"`,
      );
    }

    const patchOps = buildPatchOps({ currentUploadVersion });

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
      // Webhooks have no separate kind for the upload version
      await dispatchSavedGroupRevisionEvent(req.context, updated, {
        type: "updated",
        change: "metadata",
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
