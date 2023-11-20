import { MetricInterface } from "back-end/types/metric";
import { FactMetricInterface, FactTableMap } from "back-end/types/fact-table";
import { TemplateVariables } from "back-end/types/sql";
import { DEFAULT_CONVERSION_WINDOW_HOURS } from "./settings/resolvers/genDefaultSettings";

export type ExperimentMetricInterface = MetricInterface | FactMetricInterface;

export function isFactMetricId(id: string): boolean {
  return !!id.match(/^fact__/);
}

export function isFactMetric(
  m: ExperimentMetricInterface
): m is FactMetricInterface {
  return "metricType" in m;
}

export function getMetricTemplateVariables(
  m: ExperimentMetricInterface,
  factTableMap: FactTableMap,
  useDenominator?: boolean
): TemplateVariables {
  if (isFactMetric(m)) {
    const columnRef = useDenominator ? m.denominator : m.numerator;
    if (!columnRef) return {};

    const factTable = factTableMap.get(columnRef.factTableId);
    if (!factTable) return {};

    return {
      eventName: factTable.eventName,
    };
  }

  return m.templateVariables || {};
}

export function isBinomialMetric(m: ExperimentMetricInterface) {
  if (isFactMetric(m)) return m.metricType === "proportion";
  return m.type === "binomial";
}

export function isRatioMetric(
  m: ExperimentMetricInterface,
  denominatorMetric?: ExperimentMetricInterface
): boolean {
  if (isFactMetric(m)) return m.metricType === "ratio";
  return !!denominatorMetric && !isBinomialMetric(denominatorMetric);
}

export function isFunnelMetric(
  m: ExperimentMetricInterface,
  denominatorMetric?: ExperimentMetricInterface
): boolean {
  if (isFactMetric(m)) return false;
  return !!denominatorMetric && isBinomialMetric(denominatorMetric);
}

export function getConversionWindowHours(
  metric: ExperimentMetricInterface
): number {
  if ("conversionWindowHours" in metric && metric.conversionWindowHours) {
    return metric.conversionWindowHours;
  }

  if ("conversionWindowValue" in metric) {
    const value = metric.conversionWindowValue;
    if (metric.conversionWindowUnit === "hours") return value;
    if (metric.conversionWindowUnit === "days") return value * 24;
    if (metric.conversionWindowUnit === "weeks") return value * 24 * 7;
  }

  return DEFAULT_CONVERSION_WINDOW_HOURS || 72;
}

export function getUserIdTypes(
  metric: ExperimentMetricInterface,
  factTableMap: FactTableMap,
  useDenominator?: boolean
): string[] {
  if (isFactMetric(metric)) {
    const factTable = factTableMap.get(
      useDenominator
        ? metric.denominator?.factTableId || ""
        : metric.numerator.factTableId
    );
    return factTable?.userIdTypes || [];
  }

  return metric.userIdTypes || [];
}

export function getMetricLink(id: string): string {
  if (isFactMetricId(id)) return `/fact-metrics/${id}`;
  return `/metric/${id}`;
}
