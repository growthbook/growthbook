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
import { assertConfigValueValid } from "back-end/src/services/configValidation";
import { dispatchConfigRevisionEvent } from "back-end/src/services/configRevisionEvents";
import {
  applyRevisionToSnapshot,
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

  const { inferSchemaIfMissing } = req.body;
  // Value arrives as a native JSON object; handled as a JSON string internally.
  // (Configs are environment-agnostic — no per-environment overrides.)
  const value =
    req.body.value !== undefined ? JSON.stringify(req.body.value) : undefined;
  if (value === undefined) {
    throw new BadRequestError("Provide `value` to update.");
  }

  // Validate the raw value as a JSON object.
  assertValidConfigValueEdit(value, undefined);

  // Inheritance lives on `parent`; strip any `@config:` ref from the stored value.
  const strippedValue = stripConfigExtends(value);

  // Reject a draft value that would close a reference cycle (config namespace).
  await assertNoReferenceCycle(
    req.context,
    config.key,
    strippedValue ?? config.value,
    config.environmentValues,
    "config",
  );

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

    // Judge the staged value against the draft's OWN staged lineage/schema, not
    // the live config — a draft may have changed parent/extends/schema, so the
    // live values would produce false 400s (or miss real ones).
    const draft = applyRevisionToSnapshot(revision);

    const fieldsToUpdate: Record<string, unknown> = {};
    if (strippedValue !== undefined) fieldsToUpdate.value = strippedValue;

    // Optionally derive a schema from the value when the draft has none yet, so a
    // value-first import still gets typing/validation. Existing schemas are never
    // overwritten here — use the schema endpoint for that.
    if (
      inferSchemaIfMissing &&
      !draft.schema?.fields?.length &&
      strippedValue !== undefined
    ) {
      const obj = parsePlainJSONObject(strippedValue) ?? {};
      const inferred: SimpleSchema = {
        type: "object",
        fields: inferFieldsFromValue(obj),
      };
      fieldsToUpdate.schema =
        await req.context.models.configs.normalizeSchemaAgainstAncestors(
          {
            key: config.key,
            parent: draft.parent,
            extends: draft.extends,
            value: strippedValue,
          },
          inferred,
        );
    }

    // Enforce the staged value against the draft's effective schema. Uses the
    // proposed (inferred) schema when this request also sets one, so a value-first
    // import validates against the schema it derives. Opt out with
    // ?skipSchemaValidation=true.
    await assertConfigValueValid(
      req.context,
      {
        key: config.key,
        name: config.name,
        value: strippedValue ?? draft.value,
        schema: (fieldsToUpdate.schema as typeof config.schema) ?? draft.schema,
        parent: draft.parent,
        extends: draft.extends,
      },
      { value: strippedValue },
    );

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
      created ? { type: "created" } : { type: "updated", change: "value" },
    );

    return { revision: await toApiConfigRevision(updated, req.context) };
  } catch (err) {
    await discardIfJustCreated(req.context, revision, created);
    throw err;
  }
});
