import { putConstantRevisionValueValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import {
  buildPatchOps,
  createOrUpdateRevision,
  ensureLiveRevisionExists,
} from "back-end/src/revisions/util";
import { dispatchConstantRevisionEvent } from "back-end/src/services/constantRevisionEvents";
import { assertNoReferenceCycle } from "back-end/src/services/constants";
import {
  assertValidConstantValueEdit,
  discardIfJustCreated,
  isDraftStatus,
  pickNewDraftMetadata,
  resolveOrCreateRevision,
} from "./validations";
import { toApiConstantRevision } from "./toApiConstantRevision";

export const putConstantRevisionValue = createApiRequestHandler(
  putConstantRevisionValueValidator,
)(async (req) => {
  const constant = await req.context.models.constants.getByKey(req.params.key);
  if (!constant) {
    throw new NotFoundError("Could not find constant");
  }

  if (
    !req.context.permissions.canRevisionAction("constant", "draft", constant)
  ) {
    req.context.permissions.throwPermissionError();
  }

  const { value, environmentValues } = req.body;
  if (value === undefined && environmentValues === undefined) {
    throw new BadRequestError(
      "Provide `value` and/or `environmentValues` to update.",
    );
  }

  // Validate against the constant's type before persisting.
  assertValidConstantValueEdit(constant, value, environmentValues);

  // Reject a draft value that would close a reference cycle (merged value).
  await assertNoReferenceCycle(
    req.context,
    constant.key,
    value ?? constant.value,
    environmentValues ?? constant.environmentValues,
  );

  const fieldsToUpdate: Record<string, unknown> = {};
  if (value !== undefined) fieldsToUpdate.value = value;
  if (environmentValues !== undefined)
    fieldsToUpdate.environmentValues = environmentValues;

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
      created ? { type: "created" } : { type: "updated", change: "value" },
    );

    return { revision: await toApiConstantRevision(updated, req.context) };
  } catch (err) {
    await discardIfJustCreated(req.context, revision, created);
    throw err;
  }
});
