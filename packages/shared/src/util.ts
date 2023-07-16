import {
  ExperimentInterface,
  ExperimentInterfaceStringDates,
} from "back-end/types/experiment";
import {
  ExperimentSnapshotAnalysis,
  ExperimentSnapshotInterface,
} from "back-end/types/experiment-snapshot";
import uniqid from "uniqid";

export function getAffectedEnvsForExperiment({
  experiment,
}: {
  experiment: ExperimentInterface | ExperimentInterfaceStringDates;
}): string[] {
  // Visual changesets are not environment-scoped, so it affects all of them
  if (experiment.hasVisualChangesets) return ["__ALL__"];
  return [];
}

export function getSnapshotAnalysis(
  snapshot: ExperimentSnapshotInterface
): ExperimentSnapshotAnalysis | null {
  // TODO: add a "settings" argument to this function and use it to pick the right snapshot
  // For example, if `sequential: true` is passed in, look for an analysis with sequential enabled
  return snapshot.analyses?.[0] || null;
}

export function generateVariationId() {
  return uniqid("var_");
}
