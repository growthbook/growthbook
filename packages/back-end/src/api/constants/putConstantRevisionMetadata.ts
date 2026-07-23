import { putConstantRevisionMetadataValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import {
  buildPatchOps,
  createOrUpdateRevision,
  ensureLiveRevisionExists,
} from "back-end/src/revisions/util";
import { dispatchConstantRevisionEvent } from "back-end/src/services/constantRevisionEvents";
import {
  discardIfJustCreated,
  isDraftStatus,
  pickNewDraftMetadata,
  resolveOrCreateRevision,
} from "./validations";
import { toApiConstantRevision } from "./toApiConstantRevision";

export const putConstantRevisionMetadata = createApiRequestHandler(
  putConstantRevisionMetadataValidator,
)(async (req) => {
  const constant = await req.context.models.constants.getByKey(req.params.key);
  if (!constant) {
    throw new NotFoundError("Could not find constant");
  }

  const { name, owner, description, project } = req.body;

  // Editing draft metadata requires draft-authoring permission. Done BEFORE
  // probing project existence so it can't be an existence oracle. A `project`
  // move's destination-manage rights are re-checked at publish time.
  if (
    !req.context.permissions.canRevisionAction("constant", "draft", constant)
  ) {
    req.context.permissions.throwPermissionError();
  }

  // Mass-assignment guard: only allowlisted fields reach the patch builder.
  const fieldsToUpdate: Record<string, unknown> = {};
  if (typeof name !== "undefined") fieldsToUpdate.name = name;
  if (typeof owner !== "undefined") fieldsToUpdate.owner = owner;
  if (typeof description !== "undefined")
    fieldsToUpdate.description = description;
  if (typeof project !== "undefined") {
    if (project) {
      await req.context.models.projects.ensureProjectsExist([project]);
    }
    fieldsToUpdate.project = project;
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

    if (Object.keys(fieldsToUpdate).length === 0) {
      await discardIfJustCreated(req.context, revision, created);
      const closed =
        (await req.context.models.revisions.getById(revision.id)) ?? revision;
      return { revision: await toApiConstantRevision(closed, req.context) };
    }

    const updated = await createOrUpdateRevision(
      req.context,
      "constant",
      constant as unknown as Record<string, unknown> & { id: string },
      buildPatchOps(fieldsToUpdate),
      { revisionId: revision.id },
    );

    await dispatchConstantRevisionEvent(
      req.context,
      updated,
      created ? { type: "created" } : { type: "updated", change: "metadata" },
    );

    return { revision: await toApiConstantRevision(updated, req.context) };
  } catch (err) {
    await discardIfJustCreated(req.context, revision, created);
    throw err;
  }
});
