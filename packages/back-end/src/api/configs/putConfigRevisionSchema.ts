import { putConfigRevisionSchemaValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import {
  buildPatchOps,
  createOrUpdateRevision,
  ensureLiveRevisionExists,
} from "back-end/src/revisions/util";
import {
  applyRevisionToSnapshot,
  discardIfJustCreated,
  isDraftStatus,
  pickNewDraftMetadata,
  resolveImportedSchema,
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

  if (!req.context.permissions.canUpdateConfig(config, config)) {
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

    // The schema is resolved against the draft's own (possibly staged) value and
    // parent, so an `infer` import and "base wins" normalization both reflect
    // what the revision will publish.
    const draft = applyRevisionToSnapshot(revision);

    const { schema, warnings } = resolveImportedSchema({
      schema: req.body.schema,
      format: req.body.format,
      source: req.body.source,
      infer: req.body.infer,
      additionalProperties: req.body.additionalProperties,
      inferValue: draft.value,
    });

    // Enforce "base wins" against ancestors-at-stage-time (re-checked at publish).
    const normalizedSchema =
      await req.context.models.configs.normalizeSchemaAgainstAncestors(
        { key: config.key, parent: draft.parent, value: draft.value },
        schema,
      );

    const updated = await createOrUpdateRevision(
      req.context,
      "config",
      config as unknown as Record<string, unknown> & { id: string },
      buildPatchOps({ schema: normalizedSchema }),
      { revisionId: revision.id },
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
