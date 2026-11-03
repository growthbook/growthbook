import type {
  FactMetricData,
  FactMetricPercentileData,
} from "shared/types/integrations";

type PercentileCappedMetricData = Pick<
  FactMetricData,
  | "metric"
  | "alias"
  | "ratioMetric"
  | "numeratorSourceIndex"
  | "denominatorSourceIndex"
  | "isUpperPercentileCapped"
  | "isLowerPercentileCapped"
>;

/**
 * One entry per (tail × side) that needs a percentile threshold: upper/lower
 * tail for the numerator, plus the denominator for ratio metrics. Output
 * columns are `<valueCol>_cap` and `<valueCol>_cap_lower`.
 */
export function getFactMetricPercentileData(
  m: PercentileCappedMetricData,
  columns: { value: string; denominator: string } = {
    value: `${m.alias}_value`,
    denominator: `${m.alias}_denominator`,
  },
): FactMetricPercentileData[] {
  const tails = [
    ...(m.isUpperPercentileCapped
      ? [{ suffix: "_cap", settings: m.metric.cappingSettings }]
      : []),
    ...(m.isLowerPercentileCapped && m.metric.lowerCappingSettings
      ? [{ suffix: "_cap_lower", settings: m.metric.lowerCappingSettings }]
      : []),
  ];
  return tails.flatMap(({ suffix, settings }) => {
    const shared = {
      percentile: settings.value,
      ignoreZeros: settings.ignoreZeros ?? false,
    };
    return [
      {
        ...shared,
        valueCol: columns.value,
        outputCol: `${columns.value}${suffix}`,
        sourceIndex: m.numeratorSourceIndex,
      },
      ...(m.ratioMetric
        ? [
            {
              ...shared,
              valueCol: columns.denominator,
              outputCol: `${columns.denominator}${suffix}`,
              sourceIndex: m.denominatorSourceIndex,
            },
          ]
        : []),
    ];
  });
}
