import { putConfigRevisionArchiveValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import {
  buildPatchOps,
  createOrUpdateRevision,
  ensureLiveRevisionExists,
} from "back-end/src/revisions/util";
import { assertConstantArchivable } from "back-end/src/services/constants";
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
    throw new NotFoundError("Could not find config");
  }

  if (!req.context.permissions.canUpdateConfig(config, config)) {
    req.context.permissions.throwPermissionError();
  }

  const { archived } = req.body;

  // Block staging an archive while the config is still referenced (parity with
  // the direct archive endpoint). Unarchiving is always allowed.
  if (archived && !config.archived) {
    await assertConstantArchivable(req.context, config.id, "config");
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

    return { revision: await toApiConfigRevision(updated, req.context) };
  } catch (err) {
    await discardIfJustCreated(req.context, revision, created);
    throw err;
  }
});
