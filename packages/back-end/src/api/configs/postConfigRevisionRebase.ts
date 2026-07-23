import { isEqual } from "lodash";
import {
  checkMergeConflicts,
  JsonPatchOperation,
  normalizeProposedChanges,
} from "shared/enterprise";
import { postConfigRevisionRebaseValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import {
  BadRequestError,
  MergeConflictError,
  NotFoundError,
} from "back-end/src/util/errors";
import { getAdapter } from "back-end/src/revisions";
import { callerCanRevisionAction } from "back-end/src/revisions/revisionActions";
import { dispatchConfigRevisionEvent } from "back-end/src/services/configRevisionEvents";
import { isDraftStatus, loadRevisionByVersion } from "./validations";
import { toApiConfigRevision } from "./toApiConfigRevision";

export const postConfigRevisionRebase = createApiRequestHandler(
  postConfigRevisionRebaseValidator,
)(async (req) => {
  const config = await req.context.models.configs.getByKey(req.params.key);
  if (!config) {
    throw new NotFoundError("Could not find config");
  }

  const revision = await loadRevisionByVersion(
    req.context,
    config.id,
    req.params.version,
  );

  if (!isDraftStatus(revision.status)) {
    throw new BadRequestError(
      `Can only rebase active draft revisions (status is "${revision.status}")`,
    );
  }

  const adapter = getAdapter("config");
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

  const liveSnapshot = config as unknown as Record<string, unknown>;
  const existingOps = normalizeProposedChanges(revision.target.proposedChanges);

  const mergeResult = checkMergeConflicts(
    revision.target.snapshot as Record<string, unknown>,
    liveSnapshot,
    existingOps,
    adapter.getUpdatableFields(),
  );

  const conflicts = mergeResult.conflicts || [];
  const strategies = req.body.conflictResolutions ?? {};
  const customValues = req.body.customValues;

  // Every conflicting field needs an explicit strategy, else 400.
  for (const conflict of conflicts) {
    const strategy = strategies[conflict.field];
    if (
      strategy !== "overwrite" &&
      strategy !== "discard" &&
      strategy !== "union"
    ) {
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
        throw new BadRequestError(
          `Unsupported patch op "${op.op}" in config revision rebase`,
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
    } else if (strategy === "union") {
      // A caller-supplied resolution wins; otherwise dedup-concat the live and
      // proposed arrays (for non-arrays, fall back to the draft's value —
      // matching the internal and saved-group rebase handlers).
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
        (resolvedValue ?? null) !== null &&
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

  await dispatchConfigRevisionEvent(req.context, updated, {
    type: "rebased",
  });

  return { revision: await toApiConfigRevision(updated, req.context) };
});
