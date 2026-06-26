import { putConfigRevisionValueValidator } from "shared/validators";
import {
  stripConfigExtends,
  parsePlainJSONObject,
  inferFieldsFromValue,
} from "shared/util";
import { SimpleSchema } from "shared/types/feature";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import {
  buildPatchOps,
  createOrUpdateRevision,
  ensureLiveRevisionExists,
} from "back-end/src/revisions/util";
import { assertNoReferenceCycle } from "back-end/src/services/constants";
import {
  assertValidConfigValueEdit,
  discardIfJustCreated,
  isDraftStatus,
  pickNewDraftMetadata,
  resolveOrCreateRevision,
} from "./validations";
import { toApiConfigRevision } from "./toApiConfigRevision";

export const putConfigRevisionValue = createApiRequestHandler(
  putConfigRevisionValueValidator,
)(async (req) => {
  const config = await req.context.models.configs.getByKey(req.params.key);
  if (!config) {
    throw new NotFoundError("Could not find config");
  }

  if (!req.context.permissions.canUpdateConfig(config, config)) {
    req.context.permissions.throwPermissionError();
  }

  const { value, environmentValues, inferSchemaIfMissing } = req.body;
  if (value === undefined && environmentValues === undefined) {
    throw new BadRequestError(
      "Provide `value` and/or `environmentValues` to update.",
    );
  }

  // Validate the raw value(s) as JSON objects.
  assertValidConfigValueEdit(value, environmentValues);

  // Inheritance lives on `parent`; strip any `@config:` ref from stored values.
  const strippedValue =
    value !== undefined ? stripConfigExtends(value) : undefined;
  const strippedEnv = environmentValues
    ? Object.fromEntries(
        Object.entries(environmentValues).map(([env, v]) => [
          env,
          stripConfigExtends(v) ?? v,
        ]),
      )
    : undefined;

  // Reject a draft value that would close an `@const:` reference cycle.
  await assertNoReferenceCycle(
    req.context,
    config.key,
    strippedValue ?? config.value,
    strippedEnv ?? config.environmentValues,
  );

  const fieldsToUpdate: Record<string, unknown> = {};
  if (strippedValue !== undefined) fieldsToUpdate.value = strippedValue;
  if (strippedEnv !== undefined) fieldsToUpdate.environmentValues = strippedEnv;

  // Optionally derive a schema from the value when the config has none yet, so a
  // value-first import still gets typing/validation. Existing schemas are never
  // overwritten here — use the schema endpoint for that.
  if (
    inferSchemaIfMissing &&
    !config.schema?.fields?.length &&
    strippedValue !== undefined
  ) {
    const obj = parsePlainJSONObject(strippedValue) ?? {};
    const inferred: SimpleSchema = {
      type: "object",
      fields: inferFieldsFromValue(obj),
    };
    fieldsToUpdate.schema =
      await req.context.models.configs.normalizeSchemaAgainstAncestors(
        { key: config.key, parent: config.parent, value: strippedValue },
        inferred,
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
    if (!isDraftStatus(revision.status)) {
      throw new BadRequestError(
        `Cannot edit a revision with status "${revision.status}"`,
      );
    }

    const updated = await createOrUpdateRevision(
      req.context,
      "config",
      config as unknown as Record<string, unknown> & { id: string },
      buildPatchOps(fieldsToUpdate),
      { revisionId: revision.id },
    );

    return { revision: await toApiConfigRevision(updated, req.context) };
  } catch (err) {
    await discardIfJustCreated(req.context, revision, created);
    throw err;
  }
});
