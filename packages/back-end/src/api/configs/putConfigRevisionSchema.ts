import { putConfigRevisionSchemaValidator } from "shared/validators";
import {
  formatAncestorFieldConflictMessage,
  ancestorCollisionWarnings,
} from "shared/util";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import {
  buildPatchOps,
  createOrUpdateRevision,
  ensureLiveRevisionExists,
} from "back-end/src/revisions/util";
import { callerCanRevisionAction } from "back-end/src/revisions/revisionActions";
import { assertConfigValueValid } from "back-end/src/services/configValidation";
import { dispatchConfigRevisionEvent } from "back-end/src/services/configRevisionEvents";
import {
  applyRevisionToSnapshot,
  discardIfJustCreated,
  isDraftStatus,
  pickNewDraftMetadata,
  resolveConfigSchemaSource,
  resolveOrCreateRevision,
} from "./validations";
import { toApiConfigRevision } from "./toApiConfigRevision";

export const putConfigRevisionSchema = createApiRequestHandler(
  putConfigRevisionSchemaValidator,
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
    pickNewDraftMetadata(req.body),
  );

  try {
    if (!isDraftStatus(revision.status)) {
      throw new BadRequestError(
        `Cannot edit a revision with status "${revision.status}"`,
      );
    }

    // Resolve against the draft's own staged value/parent so `infer` and "base
    // wins" reflect what the revision will publish.
    const draft = applyRevisionToSnapshot(revision);

    const { schema, warnings } = resolveConfigSchemaSource({
      source: req.body.schema,
      infer: req.body.infer,
      additionalProperties: req.body.additionalProperties,
      inferValue: draft.value,
    });
    if (schema === undefined) {
      throw new BadRequestError(
        "Provide a schema source: `schema` (a json-schema/typescript document) or `infer: true`.",
      );
    }

    // Enforce "base wins" against ancestors-at-stage-time (re-checked at
    // publish): identical re-declarations strip with a warning; differing ones
    // reject — a strip can't preserve their intent.
    const {
      schema: normalizedSchema,
      identical,
      conflicting,
    } = await req.context.models.configs.normalizeSchemaAgainstAncestors(
      {
        key: config.key,
        parent: draft.parent,
        extends: draft.extends,
        value: draft.value,
      },
      schema,
    );
    if (conflicting.length) {
      throw new BadRequestError(
        formatAncestorFieldConflictMessage(conflicting),
      );
    }
    warnings.push(...ancestorCollisionWarnings(identical));

    // The new schema must still admit the draft's value(s).
    await assertConfigValueValid(
      req.context,
      {
        key: config.key,
        name: config.name,
        value: draft.value,
        schema: normalizedSchema,
        parent: draft.parent,
        extends: draft.extends,
      },
      { value: draft.value },
    );

    const updated = await createOrUpdateRevision(
      req.context,
      "config",
      config as unknown as Record<string, unknown> & { id: string },
      buildPatchOps({ schema: normalizedSchema }),
      { revisionId: revision.id },
    );

    await dispatchConfigRevisionEvent(
      req.context,
      updated,
      created ? { type: "created" } : { type: "updated", change: "schema" },
    );

    return {
      revision: await toApiConfigRevision(updated, req.context),
      ...(warnings.length ? { warnings } : {}),
    };
  } catch (err) {
    await discardIfJustCreated(req.context, revision, created);
    throw err;
  }
});
