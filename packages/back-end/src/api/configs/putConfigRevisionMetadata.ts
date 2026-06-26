import { putConfigRevisionMetadataValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import {
  buildPatchOps,
  createOrUpdateRevision,
  ensureLiveRevisionExists,
} from "back-end/src/revisions/util";
import { assertConfigValueValid } from "back-end/src/services/configValidation";
import { dispatchConfigRevisionEvent } from "back-end/src/services/configRevisionEvents";
import {
  applyRevisionToSnapshot,
  discardIfJustCreated,
  isDraftStatus,
  pickNewDraftMetadata,
  resolveOrCreateRevision,
} from "./validations";
import { toApiConfigRevision } from "./toApiConfigRevision";

export const putConfigRevisionMetadata = createApiRequestHandler(
  putConfigRevisionMetadataValidator,
)(async (req) => {
  const config = await req.context.models.configs.getByKey(req.params.key);
  if (!config) {
    throw new NotFoundError("Could not find config");
  }

  const { name, owner, description, project, parent, extensible } = req.body;

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
  // Empty string detaches from the parent (root config). Stage the literal value
  // (including "") so the merge clears it — `buildPatchOps` drops only
  // null/undefined. Lineage cycles are rejected at merge time by the model.
  if (typeof parent !== "undefined") {
    fieldsToUpdate.parent = parent;
  }
  if (typeof extensible !== "undefined") fieldsToUpdate.extensible = extensible;

  // Re-check edit permission against the merged change set so a `project` move
  // requires edit on both old AND new project.
  if (
    !req.context.permissions.canUpdateConfig(config, {
      project: typeof project !== "undefined" ? project : config.project,
    })
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
      return { revision: await toApiConfigRevision(closed, req.context) };
    }

    // Reparenting or toggling extensibility changes the effective ancestor
    // schema; the draft's existing value(s) must still conform (opt out with
    // ?skipSchemaValidation=true).
    if (typeof parent !== "undefined" || typeof extensible !== "undefined") {
      const draft = applyRevisionToSnapshot(revision);
      await assertConfigValueValid(
        req.context,
        {
          key: config.key,
          name: config.name,
          value: draft.value,
          schema: draft.schema,
          parent: typeof parent !== "undefined" ? parent : draft.parent,
          extensible:
            typeof extensible !== "undefined" ? extensible : draft.extensible,
        },
        { value: draft.value, environmentValues: draft.environmentValues },
      );
    }

    const updated = await createOrUpdateRevision(
      req.context,
      "config",
      config as unknown as Record<string, unknown> & { id: string },
      buildPatchOps(fieldsToUpdate),
      { revisionId: revision.id },
    );

    await dispatchConfigRevisionEvent(
      req.context,
      updated,
      created ? { type: "created" } : { type: "updated", change: "metadata" },
    );

    return { revision: await toApiConfigRevision(updated, req.context) };
  } catch (err) {
    await discardIfJustCreated(req.context, revision, created);
    throw err;
  }
});
