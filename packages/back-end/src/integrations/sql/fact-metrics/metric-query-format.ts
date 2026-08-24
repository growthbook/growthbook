import { MetricInterface } from "shared/types/metric";

export function getMetricQueryFormat(metric: MetricInterface): string {
  return metric.queryFormat || (metric.sql ? "sql" : "builder");
}
