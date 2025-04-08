import { DifferenceType } from "back-end/types/stats";
import { MetricTimeSeries } from "back-end/src/validators/metric-time-series";
import { daysBetween } from "shared/dates";
import { ExperimentMetricInterface } from "shared/src/experiments";
import { addDays } from "date-fns";
import useApi from "@/hooks/useApi";
import { useDefinitions } from "@/services/DefinitionsContext";
import {
  getExperimentMetricFormatter,
  formatPercent,
} from "@/services/metrics";
import { useSnapshot } from "./SnapshotProvider";
import ExperimentTimeSeriesGraph, {
  ExperimentTimeSeriesGraphDataPoint,
} from "./ExperimentTimeSeriesGraph";

export default function ExperimentMetricTimeSeriesGraphWrapper({
  experimentId,
  metric,
  differenceType,
  showVariations,
}: {
  experimentId: string;
  metric: ExperimentMetricInterface;
  differenceType: DifferenceType;
  showVariations: boolean[];
}) {
  const { phase } = useSnapshot();
  const { getFactTableById } = useDefinitions();
  const { data } = useApi<{ timeSeries: MetricTimeSeries[] }>(
    `/experiments/${experimentId}/time-series?phase=${phase}&metricIds[]=${metric.id}`
  );

  if (!data || !data.timeSeries || data.timeSeries.length === 0) {
    return null;
  }

  // Ensure we always render at least 7 days in case we have less than 7 days worth of data
  const additionalGraphDataPoints: ExperimentTimeSeriesGraphDataPoint[] = [];
  const timeSeries = data.timeSeries[0];
  const firstDate = timeSeries.dataPoints[0].date;
  const lastDate = timeSeries.dataPoints[timeSeries.dataPoints.length - 1].date;
  const numOfDays = daysBetween(firstDate, lastDate);
  if (numOfDays < 7) {
    additionalGraphDataPoints.push({
      d: addDays(new Date(lastDate), 7 - numOfDays),
    });
  }

  const lastIndexInvalidConfiguration = timeSeries.dataPoints.findLastIndex(
    (point) =>
      point.tags?.includes("experiment-settings-changed") ||
      point.tags?.includes("metric-settings-changed")
  );

  const dataPoints = [
    ...timeSeries.dataPoints.map((point, idx) => {
      const parsedPoint: ExperimentTimeSeriesGraphDataPoint = {
        d: new Date(point.date),
        variations: point.variations.map((i) => {
          return {
            users: i.stats?.users,

            v: i[differenceType]?.value ?? 0,
            v_formatted: `${i[differenceType]?.value ?? 0}`,
            up: i[differenceType]?.expected ?? 0,
            ctw: i[differenceType]?.chanceToWin ?? undefined,
            ci: i[differenceType]?.ci ?? undefined,
            // TODO: to create CI adjusted on the front-end
            p: i[differenceType]?.pValueAdjusted ?? i[differenceType]?.pValue,
            // TODO: What do we do with denominator?
          };
        }),
        helperText:
          idx < lastIndexInvalidConfiguration
            ? "Settings do not match current version"
            : undefined,
      };

      return parsedPoint;
    }),
    ...additionalGraphDataPoints,
  ];

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

  // Use the last data points to get the latest variation names
  const variationNames = timeSeries.dataPoints[
    timeSeries.dataPoints.length - 1
  ].variations.map((v) => v.name);

  return (
    <ExperimentTimeSeriesGraph
      yaxis="effect"
      variationNames={variationNames}
      label={labelText}
      datapoints={dataPoints}
      showVariations={showVariations}
      formatter={
        differenceType === "relative"
          ? formatPercent
          : getExperimentMetricFormatter(
              metric,
              getFactTableById,
              differenceType === "absolute" ? "percentagePoints" : "number"
            )
      }
    />
  );
}
