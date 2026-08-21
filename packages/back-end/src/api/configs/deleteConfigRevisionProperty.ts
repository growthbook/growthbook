import { deleteConfigRevisionPropertyValidator } from "shared/validators";
import { stripConfigExtends, removeOwnValueProperty } from "shared/util";
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
  resolveOrCreateRevision,
} from "./validations";
import { toApiConfigRevision } from "./toApiConfigRevision";

// Removing a property is its own verb so `null` stays a settable value.
export const deleteConfigRevisionProperty = createApiRequestHandler(
  deleteConfigRevisionPropertyValidator,
)(async (req) => {
  const config = await req.context.models.configs.getByKey(req.params.key);
  if (!config) {
    throw new NotFoundError("Could not find Config");
  }

  if (!req.context.permissions.canRevisionAction("config", "draft", config)) {
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

    // Derive and validate inside the write, so a CAS retry removes this property
    // from the row it lost to and validates the value it actually persists.
    const updated = await createOrUpdateRevision(
      req.context,
      "config",
      config as unknown as Record<string, unknown> & { id: string },
      async (row) => {
        const draft = applyRevisionToSnapshot(row ?? revision);
        const { value: nextValue, existed } = removeOwnValueProperty(
          draft.value,
          req.query.property,
        );
        if (!existed) {
          throw new NotFoundError(
            `No property "${req.query.property}" set on this config`,
          );
        }

        const strippedValue = stripConfigExtends(nextValue);

        await assertConfigValueValid(
          req.context,
          {
            key: config.key,
            name: config.name,
            value: strippedValue,
            schema: draft.schema,
            parent: draft.parent,
            extends: draft.extends,
          },
          { value: strippedValue },
        );

        return buildPatchOps({ value: strippedValue });
      },
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
