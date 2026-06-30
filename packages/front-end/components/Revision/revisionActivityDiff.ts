import {
  Revision,
  JsonPatchOperation,
  applyTopLevelPatchOps,
} from "shared/enterprise";

// Reconstruct the state on either side of a single activity-log entry by
// replaying the per-entry snapshots in chronological order. Returns `null`
// for entries that didn't change content (e.g. merged/discarded/reopened,
// or any entry from a revision created before per-entry snapshots were
// persisted). Shared between CompareSavedGroupRevisionsModal and the
// Review & Publish timeline's per-entry "Details" disclosure.
export function buildPerEntryDiffSnapshots<T>(
  revision: Revision,
  activityId: string,
): {
  baseSnapshot: T;
  proposedSnapshot: T;
} | null {
  const contentEntries = revision.activityLog
    .filter((e) => Array.isArray(e.proposedChangesSnapshot))
    .slice()
    .sort(
      (a, b) =>
        new Date(a.dateCreated).getTime() - new Date(b.dateCreated).getTime(),
    );
  const targetIdx = contentEntries.findIndex((e) => e.id === activityId);
  if (targetIdx === -1) return null;

  // Initial baseline = first content entry's targetSnapshot if captured
  // ("created" entry stores this), else fall back to the revision's current
  // `target.snapshot` (best-effort for revisions created before this field
  // existed and which haven't been rebased).
  let runningBaseline: T =
    (contentEntries[0]?.targetSnapshot as T | undefined) ??
    (revision.target.snapshot as T);
  let runningProposed: JsonPatchOperation[] = [];

  for (let i = 0; i <= targetIdx; i++) {
    const entry = contentEntries[i];
    if (i === targetIdx) {
      const beforeSnapshot = applyTopLevelPatchOps(
        runningBaseline as Record<string, unknown>,
        runningProposed,
      ) as T;
      const afterBaseline =
        (entry.targetSnapshot ?? null) !== null
          ? (entry.targetSnapshot as T)
          : runningBaseline;
      const afterSnapshot = applyTopLevelPatchOps(
        afterBaseline as Record<string, unknown>,
        (entry.proposedChangesSnapshot ?? []) as JsonPatchOperation[],
      ) as T;
      return { baseSnapshot: beforeSnapshot, proposedSnapshot: afterSnapshot };
    }
    if ((entry.targetSnapshot ?? null) !== null) {
      runningBaseline = entry.targetSnapshot as T;
    }
    runningProposed = (entry.proposedChangesSnapshot ??
      []) as JsonPatchOperation[];
  }
  return null;
}
