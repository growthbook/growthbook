import { putSavedGroupRevisionMetadataValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import {
  buildPatchOps,
  createOrUpdateRevision,
  ensureLiveRevisionExists,
} from "back-end/src/revisions/util";
import { dispatchSavedGroupRevisionEvent } from "back-end/src/services/savedGroupRevisionEvents";
import {
  assertValidDescription,
  discardIfJustCreated,
  isDraftStatus,
  pickNewDraftMetadata,
  resolveOrCreateRevision,
} from "./validations";
import { toApiSavedGroupRevision } from "./toApiSavedGroupRevision";

export const putSavedGroupRevisionMetadata = createApiRequestHandler(
  putSavedGroupRevisionMetadataValidator,
)(async (req) => {
  const savedGroup = await req.context.models.savedGroups.getById(
    req.params.savedGroupId,
  );
  if (!savedGroup) {
    throw new NotFoundError("Could not find saved group");
  }

  const { name, owner, description, projects } = req.body;

  // Mass-assignment guard: only fields in the explicit allowlist are
  // forwarded to the patch builder. New fields that should be editable via
  // metadata MUST also extend the validator body schema.
  const fieldsToUpdate: Record<string, unknown> = {};
  if (typeof name !== "undefined") fieldsToUpdate.groupName = name;
  if (typeof owner !== "undefined") fieldsToUpdate.owner = owner;
  if (typeof description !== "undefined") {
    assertValidDescription(description);
    fieldsToUpdate.description = description;
  }
  if (typeof projects !== "undefined") {
    if (projects.length > 0) {
      await req.context.models.projects.ensureProjectsExist(projects);
    }
    fieldsToUpdate.projects = projects;
  }

  // Re-check edit permission against the merged change set so a `projects`
  // move requires edit on both old AND new project sets — matches the
  // internal controller. canUpdateSavedGroup's second arg accepts a partial
  // update; the model union gives us both projection sets here.
  if (
    !req.context.permissions.canUpdateSavedGroup(savedGroup, {
      ...savedGroup,
      ...fieldsToUpdate,
    })
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

    if (Object.keys(fieldsToUpdate).length === 0) {
      // No-op: drop any auto-created draft so we don't leave one stranded.
      await discardIfJustCreated(req.context, revision, created);
      // Re-fetch the revision so the returned status reflects the actual
      // DB state ("discarded") rather than the stale in-memory "draft".
      const closed =
        (await req.context.models.revisions.getById(revision.id)) ?? revision;
      return {
        revision: await toApiSavedGroupRevision(closed, req.context),
      };
    }

    const patchOps = buildPatchOps(fieldsToUpdate);

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
