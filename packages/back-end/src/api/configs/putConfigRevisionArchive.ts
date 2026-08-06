import { putConfigRevisionArchiveValidator } from "shared/validators";
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
import { assertConfigArchiveDependentsGuard } from "back-end/src/services/archiveDependentsGuard";
import { dispatchConfigRevisionEvent } from "back-end/src/services/configRevisionEvents";
import {
  discardIfJustCreated,
  isDraftStatus,
  pickNewDraftMetadata,
  resolveOrCreateRevision,
} from "./validations";
import { toApiConfigRevision } from "./toApiConfigRevision";

export const putConfigRevisionArchive = createApiRequestHandler(
  putConfigRevisionArchiveValidator,
)(async (req) => {
  const config = await req.context.models.configs.getByKey(req.params.key);
  if (!config) {
    throw new NotFoundError("Could not find Config");
  }

  if (
    !canStageArchiveDraft({
      permissions: req.context.permissions,
      model: "config",
      entity: config,
    })
  ) {
    req.context.permissions.throwPermissionError();
  }

  const { archived } = req.body;

  // Soft-warn (bypassably) when staging an archive while the config still has
  // live dependents (references or lineage children). Unarchiving is allowed.
  if (archived && !config.archived) {
    await assertConfigArchiveDependentsGuard(
      req.context,
      {
        id: config.id,
        key: config.key,
        project: config.project,
        value: config.value,
        parent: config.parent,
        extends: config.extends,
      },
      { armed: false },
    );
  }

  await ensureLiveRevisionExists(
    req.context,
    "config",
    config as unknown as Record<string, unknown> & {
      id: string;
      owner?: string;
      dateCreated?: Date;
    },
  );

  const { revision, created } = await resolveOrCreateRevision(
    req.context,
    config,
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
        model: "config",
        entity: config,
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

    const updated = await createOrUpdateRevision(
      req.context,
      "config",
      config as unknown as Record<string, unknown> & { id: string },
      buildPatchOps({ archived }),
      { revisionId: revision.id },
    );

    await dispatchConfigRevisionEvent(
      req.context,
      updated,
      created ? { type: "created" } : { type: "updated", change: "archive" },
    );

    return { revision: await toApiConfigRevision(updated, req.context) };
  } catch (err) {
    await discardIfJustCreated(req.context, revision, created);
    throw err;
  }
});
