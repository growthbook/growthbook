import { putSavedGroupRevisionConditionValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import {
  buildPatchOps,
  createOrUpdateRevision,
  ensureLiveRevisionExists,
} from "back-end/src/revisions/util";
import { dispatchSavedGroupRevisionEvent } from "back-end/src/services/savedGroupRevisionEvents";
import {
  assertConditionGroup,
  discardIfJustCreated,
  isDraftStatus,
  pickNewDraftMetadata,
  resolveOrCreateRevision,
  validateConditionForGroup,
} from "./validations";
import { toApiSavedGroupRevision } from "./toApiSavedGroupRevision";

export const putSavedGroupRevisionCondition = createApiRequestHandler(
  putSavedGroupRevisionConditionValidator,
)(async (req) => {
  const savedGroup = await req.context.models.savedGroups.getById(
    req.params.savedGroupId,
  );
  if (!savedGroup) {
    throw new NotFoundError("Could not find saved group");
  }

  // Type-mismatch guard — only valid for condition groups.
  assertConditionGroup(savedGroup);

  const { condition } = req.body;

  if (!req.context.permissions.canUpdateSavedGroup(savedGroup, savedGroup)) {
    req.context.permissions.throwPermissionError();
  }

  // Validate condition (incl. cycle detection) against the org's group set
  // *before* creating any draft so an oversized/cyclic input never persists.
  await validateConditionForGroup(req.context, savedGroup, condition);

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

    const patchOps = buildPatchOps({ condition });

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
        change: "condition",
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
