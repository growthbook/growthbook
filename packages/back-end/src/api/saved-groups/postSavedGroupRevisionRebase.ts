import { isEqual } from "lodash";
import {
  checkMergeConflicts,
  JsonPatchOperation,
  normalizeProposedChanges,
} from "shared/enterprise";
import { postSavedGroupRevisionRebaseValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from "back-end/src/util/errors";
import { getAdapter } from "back-end/src/revisions";
import { dispatchSavedGroupRevisionEvent } from "back-end/src/services/savedGroupRevisionEvents";
import { isDraftStatus, loadRevisionByVersion } from "./validations";
import { toApiSavedGroupRevision } from "./toApiSavedGroupRevision";

export const postSavedGroupRevisionRebase = createApiRequestHandler(
  postSavedGroupRevisionRebaseValidator,
)(async (req) => {
  const savedGroup = await req.context.models.savedGroups.getById(
    req.params.savedGroupId,
  );
  if (!savedGroup) {
    throw new NotFoundError("Could not find saved group");
  }

  const revision = await loadRevisionByVersion(
    req.context,
    savedGroup.id,
    req.params.version,
  );

  if (!isDraftStatus(revision.status)) {
    throw new BadRequestError(
      `Can only rebase active draft revisions (status is "${revision.status}")`,
    );
  }

  // Anyone with edit permission can unblock a stranded draft via rebase —
  // matches the internal /revision/:id/rebase semantics.
  const adapter = getAdapter("saved-group");
  if (!adapter.canUpdate(req.context, savedGroup as Record<string, unknown>)) {
    req.context.permissions.throwPermissionError();
  }

  const baseSnapshot = revision.target.snapshot as Record<string, unknown>;
  const liveSnapshot = savedGroup as unknown as Record<string, unknown>;
  const existingOps = normalizeProposedChanges(revision.target.proposedChanges);

  const mergeResult = checkMergeConflicts(
    baseSnapshot,
    liveSnapshot,
    existingOps,
  );

  const conflicts = mergeResult.conflicts || [];
  const strategies = req.body.conflictResolutions ?? {};
  const customValues = req.body.customValues;

  // All conflicting fields must have an explicit strategy: a missing strategy
  // is a 400 — the operation is not implicitly resolved.
  for (const conflict of conflicts) {
    const strategy = strategies[conflict.field];
    if (
      strategy !== "overwrite" &&
      strategy !== "discard" &&
      strategy !== "union"
    ) {
      throw new ConflictError(
        `Please resolve conflict for field: ${conflict.field}`,
        conflicts,
      );
    }
  }

  const conflictFields = new Set(conflicts.map((c) => c.field));
  const newOps: JsonPatchOperation[] = [];
  const seenFields = new Set<string>();

  // Walk the existing ops, dropping ones that are now no-ops vs the live
  // state and rewriting conflicting ones per the caller's strategy. This
  // mirrors the internal `/revision/:id/rebase` handler.
  for (const op of existingOps) {
    const field = op.path.split("/")[1];
    if (!field || seenFields.has(field)) continue;
    seenFields.add(field);

    if (!conflictFields.has(field)) {
      // Saved-group revisions only ever produce replace/add ops (buildPatchOps).
      // A remove/move/copy op would be dropped by the value comparison below,
      // silently losing intent — fail loud if that invariant is ever broken.
      if (op.op !== "replace" && op.op !== "add") {
        throw new Error(
          `Unsupported patch op "${op.op}" in saved-group revision rebase`,
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
        conflict.proposedValue != null &&
        !isEqual(conflict.proposedValue, liveSnapshot[field])
      ) {
        newOps.push({
          op: "replace",
          path: `/${field}`,
          value: conflict.proposedValue,
        });
      }
    } else if (strategy === "union") {
      const custom = customValues?.[field];
      let resolvedValue: unknown;
      if (custom !== undefined) {
        resolvedValue = custom;
      } else if (
        Array.isArray(conflict.liveValue) &&
        Array.isArray(conflict.proposedValue)
      ) {
        const seen = new Set<string>();
        const result: unknown[] = [];
        for (const item of [
          ...(conflict.liveValue as unknown[]),
          ...(conflict.proposedValue as unknown[]),
        ]) {
          const key =
            typeof item === "object" ? JSON.stringify(item) : String(item);
          if (!seen.has(key)) {
            seen.add(key);
            result.push(item);
          }
        }
        resolvedValue = result;
      } else {
        resolvedValue = conflict.proposedValue;
      }
      if (
        resolvedValue != null &&
        !isEqual(resolvedValue, liveSnapshot[field])
      ) {
        newOps.push({
          op: "replace",
          path: `/${field}`,
          value: resolvedValue,
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

  await dispatchSavedGroupRevisionEvent(req.context, updated, {
    type: "rebased",
  });

  return {
    revision: await toApiSavedGroupRevision(updated, req.context),
  };
});
