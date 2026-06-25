import {
  ExperimentSnapshotSettings,
  SnapshotType,
} from "shared/types/experiment-snapshot";

export function shouldRunHealthTrafficQuery({
  snapshotType,
  snapshotDimensions,
  runHealthTrafficQuery,
}: {
  snapshotType: SnapshotType;
  snapshotDimensions: ExperimentSnapshotSettings["dimensions"];
  runHealthTrafficQuery?: boolean;
}): boolean {
  if (!runHealthTrafficQuery) {
    return false;
  }

  // Old-phase refreshes are exploratory snapshots with no selected dimensions.
  // They should still run traffic health queries.
  if (snapshotType === "exploratory" && snapshotDimensions.length === 0) {
    return true;
  }

  return snapshotType === "standard";
}
