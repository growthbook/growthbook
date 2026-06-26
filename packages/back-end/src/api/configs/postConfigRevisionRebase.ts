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
  if (!adapter.canUpdate(req.context, config as Record<string, unknown>)) {
    req.context.permissions.throwPermissionError();
  }

  const liveSnapshot = config as unknown as Record<string, unknown>;
  const existingOps = normalizeProposedChanges(revision.target.proposedChanges);

  const mergeResult = checkMergeConflicts(
    revision.target.snapshot as Record<string, unknown>,
    liveSnapshot,
    existingOps,
  );

  const conflicts = mergeResult.conflicts || [];
  const strategies = req.body.conflictResolutions ?? {};

  // Every conflicting field needs an explicit strategy, else 400. Config content
  // fields are scalars/objects (value/schema/etc.), so overwrite/discard apply.
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
    }
    // strategy === "discard" → drop the op (live value wins)
  }

  const updated = await req.context.models.revisions.rebase(
    revision.id,
    liveSnapshot,
    newOps,
    req.context.userId,
  );

  return { revision: await toApiConfigRevision(updated, req.context) };
});
