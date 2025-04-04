import { addDays } from "date-fns";
import { ExperimentMetricInterface } from "shared/src/experiments";
import { MetricTimeSeries } from "back-end/src/validators/metric-time-series";
import { DifferenceType } from "back-end/types/stats";
import { daysBetween } from "shared/dates";
import useApi from "@/hooks/useApi";
import { formatNumber } from "@/services/metrics";
import ExperimentDateGraph, {
  ExperimentDateGraphDataPoint,
} from "./ExperimentDateGraph";

export default function MetricTimeSeriesGraph({
  metric,
  experimentId,
  phase,
  differenceType,
}: {
  metric: ExperimentMetricInterface;
  experimentId: string;
  phase: number;
  differenceType: DifferenceType;
}) {
  // TODO: Fix phase
  const { data } = useApi<{ timeSeries: MetricTimeSeries[] }>(
    `/experiments/${experimentId}/time-series?metricIds[]=${metric.id}`
  );

  const labelText = (() => {
    switch (differenceType) {
      case "absolute":
        return "Absolute Change";
      case "relative":
        return "% Lift";
      case "scaled":
        return "Scaled Impact";
    }
  })();

  if (!data || !data.timeSeries || data.timeSeries.length === 0) {
    return null;
  }

  const timeSeries = data.timeSeries[0];
  const additionalGraphDataPoints: ExperimentDateGraphDataPoint[] = [];
  const sortedDataPoints = timeSeries.dataPoints.sort((a, b) => {
    return new Date(a.date).getTime() - new Date(b.date).getTime();
  });

  const firstDate = sortedDataPoints[0].date;
  const lastDate = sortedDataPoints[sortedDataPoints.length - 1].date;

  const numOfDays = daysBetween(firstDate, lastDate);
  if (numOfDays < 7) {
    additionalGraphDataPoints.push({
      d: addDays(new Date(lastDate), 7 - numOfDays),
    });
  }

  return (
    <ExperimentDateGraph
      hideVariationsSelector={true}
      yaxis="effect"
      label={labelText}
      variationNames={timeSeries.dataPoints[0].variations.map((v) => v.name)}
      datapoints={[
        ...timeSeries.dataPoints.map((r) => {
          const point: ExperimentDateGraphDataPoint = {
            d: new Date(r.date),
            variations: r.variations.map((i) => {
              return {
                users: i.stats?.users,

                v: i[differenceType]?.value ?? 0,
                v_formatted: `${i[differenceType]?.value ?? 0}`,
                up: i[differenceType]?.expected ?? 0,
                ctw: i[differenceType]?.chanceToWin ?? undefined,
                ci: i[differenceType]?.ci ?? undefined,
                // TODO: What do we do with pValue, pValueAdjusted & denominator?
              };
            }),
          };

          if (
            r.tags?.includes("experiment-settings-changed") &&
            r.tags?.includes("metric-settings-changed")
          ) {
            point.helperText = "Experiment and metric settings changed";
          } else if (r.tags?.includes("experiment-settings-changed")) {
            point.helperText = "Experiment settings changed";
          } else if (r.tags?.includes("metric-settings-changed")) {
            point.helperText = "Metric settings changed";
          }

          return point;
        }),
        ...additionalGraphDataPoints,
      ]}
      formatter={formatNumber}
    />
  );
}
