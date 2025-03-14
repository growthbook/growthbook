import { ExperimentMetricInterface } from "shared/src/experiments";
import { MetricTimeSeries } from "back-end/src/validators/metric-time-series";
import useApi from "@/hooks/useApi";
import { formatNumber } from "@/services/metrics";
import ExperimentDateGraph from "./ExperimentDateGraph";

export default function MetricTimeSeriesGraph({
  metric,
  experimentId,
}: {
  metric: ExperimentMetricInterface;
  experimentId: string;
}) {
  const { data } = useApi<{ timeSeries: MetricTimeSeries[] }>(
    `/experiments/${experimentId}/time-series?metricIds[]=${metric.id}`
  );

  const differenceType = "absolute" as string;
  const type = (() => {
    switch (differenceType) {
      case "absolute":
        return "absolute";
      case "relative":
        return "relative";
      case "scaled":
        return "scaled";
      default:
        return "absolute";
    }
  })();

  if (!data || !data.timeSeries) {
    return null;
  }

  const timeSeries = data.timeSeries[0];

  return (
    <ExperimentDateGraph
      yaxis="effect"
      label="Something"
      variationNames={timeSeries.dataPoints[0].variations.map((v) => v.name)}
      datapoints={timeSeries.dataPoints.map((r) => {
        return {
          d: new Date(r.date),
          variations: r.variations.map((i) => {
            return {
              v: i[type]?.value ?? 0,
              v_formatted: `${i[type]?.value ?? 0}`,
              users: i[type]?.denominator,
              p: i[type]?.pValue ?? undefined,
              ctw: i[type]?.chanceToWin ?? undefined,
              ci: i[type]?.ci ?? undefined,
            };
          }),
        };
      })}
      formatter={formatNumber}
    />
  );
}
