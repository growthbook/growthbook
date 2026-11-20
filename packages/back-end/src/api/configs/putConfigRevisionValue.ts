import { putConfigRevisionValueValidator } from "shared/validators";
import {
  stripConfigExtends,
  parsePlainJSONObject,
  inferFieldsFromValue,
  ancestorCollisionWarnings,
  SchemaWarning,
  valueHasReferenceToken,
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
  assertConfigValueValid,
  configDraftState,
  configValidationLeaf,
  getEffectiveConfigSchema,
} from "back-end/src/services/configValidation";
import { dispatchConfigRevisionEvent } from "back-end/src/services/configRevisionEvents";
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
    throw new NotFoundError("Could not find Config");
  }

  if (!req.context.permissions.canRevisionAction("config", "draft", config)) {
    req.context.permissions.throwPermissionError();
  }

  const { inferSchemaIfMissing, inferUndeclaredFields } = req.body;
  // Value arrives as a native JSON object; handled as a JSON string internally.
  const value =
    req.body.value !== undefined ? JSON.stringify(req.body.value) : undefined;
  if (value === undefined) {
    throw new BadRequestError("Provide `value` to update.");
  }

  assertValidConfigValueEdit(value);

  const warnings: SchemaWarning[] = [];

  // Inheritance lives on `parent`; strip any `@config:` ref from the stored value.
  const strippedValue = stripConfigExtends(value);

  // Reject a draft value that would close a reference cycle (config namespace).
  await assertNoReferenceCycle(
    req.context,
    config.key,
    strippedValue ?? config.value,
    undefined,
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

    // Judge against the draft's OWN staged lineage/schema, not live: a draft may
    // have changed parent/extends/schema, so live values would give false results.
    const draft = configDraftState(config, revision);

    const fieldsToUpdate: Record<string, unknown> = {};
    if (strippedValue !== undefined) fieldsToUpdate.value = strippedValue;

    // Derive a schema from the value only when the draft has none, so a
    // value-first import gets typing; existing schemas are never overwritten here.
    // Ancestor-owned collisions here warn instead of rejecting — even a
    // contract-differing one: inferred fields are type GUESSES from the value,
    // not user declarations, so a pure value write must never 400 because a
    // guess differs from an ancestor's richer definition.
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
      const { schema, identical, conflicting } =
        await req.context.models.configs.normalizeSchemaAgainstAncestors(
          {
            key: config.key,
            parent: draft.parent,
            extends: draft.extends,
            value: strippedValue,
          },
          inferred,
        );
      fieldsToUpdate.schema = schema;
      warnings.push(
        ...ancestorCollisionWarnings([...identical, ...conflicting]),
      );
    } else if (inferUndeclaredFields && strippedValue !== undefined) {
      // Only keys no field in the family declares, so an existing field is
      // never widened; references stay undeclared, as validation skips them.
      const { fields: declared } = await getEffectiveConfigSchema(
        req.context,
        configValidationLeaf(draft),
      );
      const obj = parsePlainJSONObject(strippedValue) ?? {};
      const added = inferFieldsFromValue(
        Object.fromEntries(
          Object.entries(obj).filter(([, v]) => !valueHasReferenceToken(v)),
        ),
        new Set(declared.map((f) => f.key)),
      ).map((f) => ({ ...f, required: false }));
      if (added.length) {
        fieldsToUpdate.schema = {
          type: "object",
          ...draft.schema,
          fields: [...(draft.schema?.fields ?? []), ...added],
        };
        warnings.push(
          ...added.map((f) => ({
            code: "inferred-field" as const,
            path: f.key,
            message: `Added optional field "${f.key}" to this draft's schema, inferred from its value.`,
          })),
        );
      }
    }

    // Validate against the proposed (inferred) schema when this request sets one,
    // so a value-first import validates against the schema it derives.
    await assertConfigValueValid(
      req.context,
      configValidationLeaf(draft, fieldsToUpdate),
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

    return {
      revision: await toApiConfigRevision(updated, req.context),
      ...(warnings.length ? { warnings } : {}),
    };
  } catch (err) {
    await discardIfJustCreated(req.context, revision, created);
    throw err;
  }
});
