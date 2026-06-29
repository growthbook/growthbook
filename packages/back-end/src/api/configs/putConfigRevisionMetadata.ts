import { isEqual } from "lodash";
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
  const extendsKeys = req.body.extends;

  // Re-check edit permission against the merged change set so a `project` move
  // requires edit on both old AND new project. Done BEFORE probing project
  // existence so the endpoint can't be used as an existence oracle.
  if (
    !req.context.permissions.canUpdateConfig(config, {
      project: typeof project !== "undefined" ? project : config.project,
    })
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
  // Empty string detaches from the parent (root config). Stage the literal value
  // (including "") so the merge clears it — `buildPatchOps` drops only
  // null/undefined. Lineage cycles are rejected at merge time by the model.
  if (typeof parent !== "undefined") {
    fieldsToUpdate.parent = parent;
  }
  // Store the array as-is (including `[]` to clear all mixins). `undefined` is
  // dropped by buildPatchOps and would silently no-op the clear.
  if (typeof extendsKeys !== "undefined") {
    fieldsToUpdate.extends = extendsKeys;
  }
  if (typeof extensible !== "undefined") fieldsToUpdate.extensible = extensible;

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

    // Reparenting, changing mixins, or toggling extensibility changes the
    // effective ancestor schema; the draft's existing value(s) must still
    // conform.
    if (
      typeof parent !== "undefined" ||
      typeof extendsKeys !== "undefined" ||
      typeof extensible !== "undefined"
    ) {
      const draft = applyRevisionToSnapshot(revision);
      const effectiveParent =
        typeof parent !== "undefined" ? parent : draft.parent;
      const effectiveExtends =
        typeof extendsKeys !== "undefined" ? extendsKeys : draft.extends;
      await assertConfigValueValid(
        req.context,
        {
          key: config.key,
          name: config.name,
          value: draft.value,
          schema: draft.schema,
          parent: effectiveParent,
          extends: effectiveExtends,
          extensible:
            typeof extensible !== "undefined" ? extensible : draft.extensible,
        },
        { value: draft.value },
      );

      // A lineage change shifts which fields the bases own, so re-normalize the
      // draft's own schema now ("base wins"). Without this, reviewers see a stale
      // schema until publish re-runs normalization. Extensibility alone doesn't
      // change ownership, so only re-normalize on parent/extends edits.
      if (
        draft.schema &&
        (typeof parent !== "undefined" || typeof extendsKeys !== "undefined")
      ) {
        const normalizedSchema =
          await req.context.models.configs.normalizeSchemaAgainstAncestors(
            {
              key: config.key,
              parent: effectiveParent || undefined,
              extends: effectiveExtends,
              value: draft.value,
            },
            draft.schema,
          );
        if (!isEqual(normalizedSchema, draft.schema)) {
          fieldsToUpdate.schema = normalizedSchema;
        }
      }
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
