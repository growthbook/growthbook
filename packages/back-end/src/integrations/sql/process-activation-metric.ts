import cloneDeep from "lodash/cloneDeep";
import { ExperimentMetricInterface } from "shared/experiments";
import { ExperimentSnapshotSettings } from "shared/types/experiment-snapshot";
import { applyMetricOverrides } from "back-end/src/util/integration";

export function processActivationMetric(
  activationMetricDoc: null | ExperimentMetricInterface,
  settings: ExperimentSnapshotSettings,
): null | ExperimentMetricInterface {
  let activationMetric: null | ExperimentMetricInterface = null;
  if (activationMetricDoc) {
    activationMetric =
      cloneDeep<ExperimentMetricInterface>(activationMetricDoc);
    applyMetricOverrides(activationMetric, settings);
  }
  return activationMetric;
}
