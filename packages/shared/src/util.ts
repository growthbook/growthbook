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

  // TODO: get actual environments for linked feature flags. We are being overly conservative here
  if (experiment.linkedFeatures && experiment.linkedFeatures.length > 0) {
    return ["__ALL__"];
  }

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

export function experimentHasLinkedChanges(
  exp: ExperimentInterface | ExperimentInterfaceStringDates
): boolean {
  if (exp.hasVisualChangesets) return true;
  if (exp.linkedFeatures && exp.linkedFeatures.length > 0) return true;
  return false;
}

export function includeExperimentInPayload(
  exp: ExperimentInterface | ExperimentInterfaceStringDates
): boolean {
  // Archived experiments are always excluded
  if (exp.archived) return false;

  if (!experimentHasLinkedChanges(exp)) return false;

  // Stopped experiments are only included if they are currently releasing a winning variant
  if (exp.status === "stopped") {
    if (exp.excludeFromPayload) return false;
    if (!exp.releasedVariationId) return false;
  }

  return true;
}
