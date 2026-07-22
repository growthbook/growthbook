import { putConstantRevisionArchiveValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import {
  buildPatchOps,
  createOrUpdateRevision,
  ensureLiveRevisionExists,
} from "back-end/src/revisions/util";
import { dispatchConstantRevisionEvent } from "back-end/src/services/constantRevisionEvents";
import { assertConstantArchiveDependentsGuard } from "back-end/src/services/archiveDependentsGuard";
import {
  discardIfJustCreated,
  isDraftStatus,
  pickNewDraftMetadata,
  resolveOrCreateRevision,
} from "./validations";
import { toApiConstantRevision } from "./toApiConstantRevision";

export const putConstantRevisionArchive = createApiRequestHandler(
  putConstantRevisionArchiveValidator,
)(async (req) => {
  const constant = await req.context.models.constants.getByKey(req.params.key);
  if (!constant) {
    throw new NotFoundError("Could not find constant");
  }

  if (!req.context.permissions.canUpdateConstant(constant, constant)) {
    req.context.permissions.throwPermissionError();
  }

  const { archived } = req.body;

  // Soft-warn (bypassably) when staging an archive while the constant is still
  // referenced. Unarchiving is always allowed.
  if (archived && !constant.archived) {
    await assertConstantArchiveDependentsGuard(
      req.context,
      { id: constant.id, key: constant.key, project: constant.project },
      { armed: false },
    );
  }

  await ensureLiveRevisionExists(
    req.context,
    "constant",
    constant as unknown as Record<string, unknown> & {
      id: string;
      owner?: string;
      dateCreated?: Date;
    },
  );

  const { revision, created } = await resolveOrCreateRevision(
    req.context,
    constant,
    req.params.version,
    pickNewDraftMetadata(req.body),
  );

  try {
    if (!isDraftStatus(revision.status)) {
      throw new BadRequestError(
        `Cannot edit a revision with status "${revision.status}"`,
      );
    }

    const updated = await createOrUpdateRevision(
      req.context,
      "constant",
      constant as unknown as Record<string, unknown> & { id: string },
      buildPatchOps({ archived }),
      { revisionId: revision.id },
    );

    await dispatchConstantRevisionEvent(
      req.context,
      updated,
      created ? { type: "created" } : { type: "updated", change: "archive" },
    );

    return { revision: await toApiConstantRevision(updated, req.context) };
  } catch (err) {
    await discardIfJustCreated(req.context, revision, created);
    throw err;
  }
});
