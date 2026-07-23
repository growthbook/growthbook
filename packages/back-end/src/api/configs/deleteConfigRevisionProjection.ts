import { deleteConfigRevisionProjectionValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import {
  buildPatchOps,
  createOrUpdateRevision,
  ensureLiveRevisionExists,
} from "back-end/src/revisions/util";
import { callerCanRevisionAction } from "back-end/src/revisions/revisionActions";
import { dispatchConfigRevisionEvent } from "back-end/src/services/configRevisionEvents";
import {
  applyRevisionToSnapshot,
  discardIfJustCreated,
  isDraftStatus,
  resolveOrCreateRevision,
} from "./validations";
import { toApiConfigRevision } from "./toApiConfigRevision";

// The canonical schema is untouched; only `renderProjections[source]` is dropped.
export const deleteConfigRevisionProjection = createApiRequestHandler(
  deleteConfigRevisionProjectionValidator,
)(async (req) => {
  const config = await req.context.models.configs.getByKey(req.params.key);
  if (!config) {
    throw new NotFoundError("Could not find config");
  }

  if (
    !callerCanRevisionAction(
      req.context,
      "config",
      "draft",
      config as Record<string, unknown>,
    )
  ) {
    req.context.permissions.throwPermissionError();
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
  );

  try {
    if (!isDraftStatus(revision.status)) {
      throw new BadRequestError(
        `Cannot edit a revision with status "${revision.status}"`,
      );
    }

    const draft = applyRevisionToSnapshot(revision);
    const current = draft.renderProjections ?? {};
    if (!(req.query.source in current)) {
      throw new NotFoundError(
        `No projection found for source "${req.query.source}"`,
      );
    }
    const next = { ...current };
    delete next[req.query.source];

    const updated = await createOrUpdateRevision(
      req.context,
      "config",
      config as unknown as Record<string, unknown> & { id: string },
      buildPatchOps({ renderProjections: next }),
      { revisionId: revision.id },
    );

    await dispatchConfigRevisionEvent(
      req.context,
      updated,
      created ? { type: "created" } : { type: "updated", change: "schema" },
    );

    return { revision: await toApiConfigRevision(updated, req.context) };
  } catch (err) {
    await discardIfJustCreated(req.context, revision, created);
    throw err;
  }
});
