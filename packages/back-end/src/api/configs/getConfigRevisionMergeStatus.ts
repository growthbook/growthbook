import { getConfigRevisionMergeStatusValidator } from "shared/validators";
import {
  checkMergeConflicts,
  normalizeProposedChanges,
} from "shared/enterprise";
import { ConfigInterface } from "shared/types/config";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { NotFoundError } from "back-end/src/util/errors";
import { getAdapter } from "back-end/src/revisions";
import { loadRevisionByVersion } from "./validations";

export const getConfigRevisionMergeStatus = createApiRequestHandler(
  getConfigRevisionMergeStatusValidator,
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

  const adapter = getAdapter("config");
  const baseSnapshot = adapter.buildSnapshot(
    revision.target.snapshot as ConfigInterface,
  ) as Record<string, unknown>;
  const liveSnapshot = adapter.buildSnapshot(config) as Record<string, unknown>;

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
