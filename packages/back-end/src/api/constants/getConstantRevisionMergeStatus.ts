import { getConstantRevisionMergeStatusValidator } from "shared/validators";
import {
  checkMergeConflicts,
  normalizeProposedChanges,
} from "shared/enterprise";
import { ConstantInterface } from "shared/types/constant";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { NotFoundError } from "back-end/src/util/errors";
import { getAdapter } from "back-end/src/revisions";
import { loadRevisionByVersion } from "./validations";

export const getConstantRevisionMergeStatus = createApiRequestHandler(
  getConstantRevisionMergeStatusValidator,
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

  const adapter = getAdapter("constant");
  const baseSnapshot = adapter.buildSnapshot(
    revision.target.snapshot as ConstantInterface,
  ) as Record<string, unknown>;
  const liveSnapshot = adapter.buildSnapshot(constant) as Record<
    string,
    unknown
  >;

  const result = checkMergeConflicts(
    baseSnapshot,
    liveSnapshot,
    normalizeProposedChanges(revision.target.proposedChanges),
    adapter.getUpdatableFields(),
  );

  return {
    success: result.success,
    hasConflicts: result.conflicts.length > 0,
    conflicts: result.conflicts,
    canAutoMerge: result.canAutoMerge,
  };
});
