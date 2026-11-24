import cloneDeep from "lodash/cloneDeep";
import {
  ExperimentMetricInterface,
  isFactCompoundMetric,
  isFactFunnelMetric,
} from "shared/experiments";
import { ExperimentSnapshotSettings } from "shared/types/experiment-snapshot";
import { applyMetricOverrides } from "back-end/src/util/integration";

export function processActivationMetric(
  activationMetricDoc: null | ExperimentMetricInterface,
  settings: Pick<ExperimentSnapshotSettings, "metricSettings">,
): null | ExperimentMetricInterface {
  let activationMetric: null | ExperimentMetricInterface = null;
  if (activationMetricDoc) {
    // The picker hides these types, but a metric already chosen for
    // activation can be converted afterwards. They have no numerator, so
    // the activation CTE can't be built from them.
    if (
      isFactCompoundMetric(activationMetricDoc) ||
      isFactFunnelMetric(activationMetricDoc)
    ) {
      throw new Error(
        `"${activationMetricDoc.name}" is now a ${activationMetricDoc.metricType} metric and cannot be used for activation. Remove it as the experiment's activation metric.`,
      );
    }
    activationMetric =
      cloneDeep<ExperimentMetricInterface>(activationMetricDoc);
    applyMetricOverrides(activationMetric, settings);
  }
  return activationMetric;
}
