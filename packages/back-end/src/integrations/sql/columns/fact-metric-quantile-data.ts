import type {
  FactMetricData,
  FactMetricQuantileData,
} from "shared/types/integrations";
import type { MetricQuantileSettings } from "shared/types/fact-table";

export function getFactMetricQuantileData(
  metricData: FactMetricData[],
  quantileType: MetricQuantileSettings["type"],
): FactMetricQuantileData[] {
  const quantileData: FactMetricQuantileData[] = [];
  metricData
    .filter((m) => m.quantileMetric === quantileType)
    .forEach((m) => {
      quantileData.push({
        alias: m.alias,
        valueCol: `${m.alias}_value`,
        outputCol: `${m.alias}_value_quantile`,
        metricQuantileSettings: m.metricQuantileSettings,
      });
    });
  return quantileData;
}
