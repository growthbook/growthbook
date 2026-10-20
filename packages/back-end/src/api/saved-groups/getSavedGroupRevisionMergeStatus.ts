import { getSavedGroupRevisionMergeStatusValidator } from "shared/validators";
import {
  checkMergeConflicts,
  normalizeProposedChanges,
} from "shared/enterprise";
import { SavedGroupInterface } from "shared/types/saved-group";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { NotFoundError } from "back-end/src/util/errors";
import { getAdapter } from "back-end/src/revisions";
import { loadRevisionByVersion } from "./validations";

export const getSavedGroupRevisionMergeStatus = createApiRequestHandler(
  getSavedGroupRevisionMergeStatusValidator,
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

  const adapter = getAdapter("saved-group");
  const baseSnapshot = adapter.buildSnapshot(
    revision.target.snapshot as SavedGroupInterface,
  ) as Record<string, unknown>;
  const liveSnapshot = adapter.buildSnapshot(savedGroup) as Record<
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
