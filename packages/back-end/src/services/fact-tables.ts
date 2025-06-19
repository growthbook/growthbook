import { FactMetricInterface } from "back-end/types/fact-table";

export function filterFactMetricsFromFactTable(
  id: string,
  factMetrics: FactMetricInterface[]
): FactMetricInterface[] {
  return factMetrics.filter(
    (factMetric) =>
      factMetric.numerator.factTableId === id ||
      (factMetric.denominator && factMetric.denominator.factTableId === id)
  );
}
