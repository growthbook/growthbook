import { ExperimentMetricInterface } from "shared/experiments";
import { ExperimentSnapshotSettings } from "../../types/experiment-snapshot";

// mutates metric object itself!
export function applyMetricOverrides(
  metric: ExperimentMetricInterface,
  settings: ExperimentSnapshotSettings,
): void {
  if (!metric) return;

  const computed = settings.metricSettings.find(
    (s) => s.id === metric.id,
  )?.computedSettings;
  if (!computed) return;

  metric.windowSettings = computed.windowSettings;
  metric.regressionAdjustmentEnabled = computed.regressionAdjustmentEnabled;
  metric.regressionAdjustmentDays = computed.regressionAdjustmentDays;

  // TODO: move this to the form validation when saving this settings
  if (metric.regressionAdjustmentDays < 0) {
    metric.regressionAdjustmentDays = 0;
  }
  if (metric.regressionAdjustmentDays > 100) {
    metric.regressionAdjustmentDays = 100;
  }
  return;
}
