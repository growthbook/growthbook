import { putConfigRevisionPropertyValidator } from "shared/validators";
import { stripConfigExtends, setOwnValueProperty } from "shared/util";
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

// One property at a time, applied to the draft's current value — so a stale
// read can't drop properties another writer added.
export const putConfigRevisionProperty = createApiRequestHandler(
  putConfigRevisionPropertyValidator,
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
    pickNewDraftMetadata(req.body),
  );

  try {
    if (!isDraftStatus(revision.status)) {
      throw new BadRequestError(
        `Cannot edit a revision with status "${revision.status}"`,
      );
    }

    const draft = applyRevisionToSnapshot(revision);
    const nextValue = setOwnValueProperty(
      draft.value,
      req.body.property,
      req.body.value,
    );

    assertValidConfigValueEdit(nextValue);
    const strippedValue = stripConfigExtends(nextValue) ?? nextValue;

    await assertNoReferenceCycle(
      req.context,
      config.key,
      strippedValue,
      undefined,
      "config",
    );

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

    // Derive inside the write so a CAS retry re-applies this property to the
    // row it lost to, instead of replaying the value computed above.
    const updated = await createOrUpdateRevision(
      req.context,
      "config",
      config as unknown as Record<string, unknown> & { id: string },
      (row) => {
        const value = row
          ? setOwnValueProperty(
              applyRevisionToSnapshot(row).value,
              req.body.property,
              req.body.value,
            )
          : nextValue;
        return buildPatchOps({
          value: stripConfigExtends(value) ?? value,
        });
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
