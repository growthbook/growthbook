import { putSavedGroupRevisionValuesValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import {
  buildPatchOps,
  createOrUpdateRevision,
  ensureLiveRevisionExists,
} from "back-end/src/revisions/util";
import { callerCanRevisionAction } from "back-end/src/revisions/revisionActions";
import { dispatchSavedGroupRevisionEvent } from "back-end/src/services/savedGroupRevisionEvents";
import {
  assertListGroup,
  assertValidListAttributeKey,
  dedupeValues,
  discardIfJustCreated,
  isDraftStatus,
  pickNewDraftMetadata,
  resolveOrCreateRevision,
  validateListSize,
} from "./validations";
import { toApiSavedGroupRevision } from "./toApiSavedGroupRevision";

export const putSavedGroupRevisionValues = createApiRequestHandler(
  putSavedGroupRevisionValuesValidator,
)(async (req) => {
  const savedGroup = await req.context.models.savedGroups.getById(
    req.params.savedGroupId,
  );
  if (!savedGroup) {
    throw new NotFoundError("Could not find saved group");
  }

  // Type-mismatch guard — only valid for list groups.
  assertListGroup(savedGroup);
  assertValidListAttributeKey(req.context, savedGroup);

  if (
    !callerCanRevisionAction(
      req.context,
      "saved-group",
      "draft",
      savedGroup as Record<string, unknown>,
    )
  ) {
    req.context.permissions.throwPermissionError();
  }

  const newValues = dedupeValues(req.body.values);

  // Reject before persisting so an oversized draft is never written.
  validateListSize(
    newValues,
    req.context.org.settings?.savedGroupSizeLimit,
    req.context.permissions.canBypassSavedGroupSizeLimit(savedGroup.projects),
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

    const patchOps = buildPatchOps({ values: newValues });

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
        change: "values",
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
