import { DashboardSettingsInterface } from "back-end/src/enterprise/validators/dashboard-instance";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";

export function getDefaultDashboardSettingsForExperiment(
  experiment: ExperimentInterfaceStringDates
): DashboardSettingsInterface {
  return {
    baselineRow: 0,
    dateStart: new Date(Date.now() - 30 * 1000 * 3600 * 24),
    dateEnd: new Date(),
    defaultMetricId: experiment.goalMetrics[0],
    defaultVariationIds: experiment.variations.map(({ id }) => id),
    defaultDimensionId: "",
    defaultDimensionValues: [],
  };
}
