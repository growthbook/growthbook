import {
  ExperimentInterface,
  ExperimentInterfaceStringDates,
} from "back-end/types/experiment";

export function getAffectedEnvsForExperiment({
  experiment,
}: {
  experiment: ExperimentInterface | ExperimentInterfaceStringDates;
}): string[] {
  // Visual changesets are not environment-scoped, so it affects all of them
  if (experiment.hasVisualChangesets) return ["__ALL__"];
  return [];
}
