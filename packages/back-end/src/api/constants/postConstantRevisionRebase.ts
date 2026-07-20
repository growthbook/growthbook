import { isEqual } from "lodash";
import {
  checkMergeConflicts,
  JsonPatchOperation,
  normalizeProposedChanges,
} from "shared/enterprise";
import { postConstantRevisionRebaseValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import {
  BadRequestError,
  MergeConflictError,
  NotFoundError,
} from "back-end/src/util/errors";
import { getAdapter } from "back-end/src/revisions";
import { dispatchConstantRevisionEvent } from "back-end/src/services/constantRevisionEvents";
import { isDraftStatus, loadRevisionByVersion } from "./validations";
import { toApiConstantRevision } from "./toApiConstantRevision";

export const postConstantRevisionRebase = createApiRequestHandler(
  postConstantRevisionRebaseValidator,
)(async (req) => {
  const constant = await req.context.models.constants.getByKey(req.params.key);
  if (!constant) {
    throw new NotFoundError("Could not find constant");
  }

  const revision = await loadRevisionByVersion(
    req.context,
    constant.id,
    req.params.version,
  );

  if (!isDraftStatus(revision.status)) {
    throw new BadRequestError(
      `Can only rebase active draft revisions (status is "${revision.status}")`,
    );
  }

  const adapter = getAdapter("constant");
  if (!adapter.canUpdate(req.context, constant as Record<string, unknown>)) {
    req.context.permissions.throwPermissionError();
  }

  const liveSnapshot = constant as unknown as Record<string, unknown>;
  const existingOps = normalizeProposedChanges(revision.target.proposedChanges);

  const mergeResult = checkMergeConflicts(
    revision.target.snapshot as Record<string, unknown>,
    liveSnapshot,
    existingOps,
    adapter.getUpdatableFields(),
  );

  const conflicts = mergeResult.conflicts || [];
  const strategies = req.body.conflictResolutions ?? {};

  // Every conflicting field needs an explicit strategy, else 400. Constants have
  // no array field, so only overwrite/discard apply (no `union`).
  for (const conflict of conflicts) {
    const strategy = strategies[conflict.field];
    if (strategy !== "overwrite" && strategy !== "discard") {
      throw new MergeConflictError(
        `Please resolve conflict for field: ${conflict.field}`,
        conflicts,
      );
    }
  }

  const conflictFields = new Set(conflicts.map((c) => c.field));
  const newOps: JsonPatchOperation[] = [];
  const seenFields = new Set<string>();

  for (const op of existingOps) {
    const field = op.path.split("/")[1];
    if (!field || seenFields.has(field)) continue;
    seenFields.add(field);

    if (!conflictFields.has(field)) {
      if (op.op !== "replace" && op.op !== "add") {
        throw new Error(
          `Unsupported patch op "${op.op}" in constant revision rebase`,
        );
      }
      if (!isEqual(op.value, liveSnapshot[field])) {
        newOps.push(op);
      }
      continue;
    }

    const strategy = strategies[field];
    const conflict = conflicts.find((c) => c.field === field);
    if (!conflict) continue;
    if (strategy === "overwrite") {
      if (
        (conflict.proposedValue ?? null) !== null &&
        !isEqual(conflict.proposedValue, liveSnapshot[field])
      ) {
        newOps.push({
          op: "replace",
          path: `/${field}`,
          value: conflict.proposedValue,
        });
      }
    }
    // strategy === "discard" → drop the op (live value wins)
  }

  const updated = await req.context.models.revisions.rebase(
    revision.id,
    liveSnapshot,
    newOps,
    req.context.userId,
  );

  await dispatchConstantRevisionEvent(req.context, updated, {
    type: "rebased",
  });

  return { revision: await toApiConstantRevision(updated, req.context) };
});
