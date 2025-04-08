import { DifferenceType, StatsEngine } from "back-end/types/stats";
import { ExperimentStatus } from "back-end/src/validators/experiments";
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
import { getAdjustedCI } from "@/services/experiments";
import usePValueThreshold from "@/hooks/usePValueThreshold";
import { useSnapshot } from "./SnapshotProvider";
import ExperimentTimeSeriesGraph, {
  ExperimentTimeSeriesGraphDataPoint,
} from "./ExperimentTimeSeriesGraph";

export default function ExperimentMetricTimeSeriesGraphWrapper({
  experimentId,
  experimentStatus,
  metric,
  differenceType,
  showVariations,
  statsEngine,
  pValueAdjustmentEnabled,
}: {
  experimentId: string;
  experimentStatus: ExperimentStatus;
  metric: ExperimentMetricInterface;
  differenceType: DifferenceType;
  showVariations: boolean[];
  statsEngine: StatsEngine;
  pValueAdjustmentEnabled: boolean;
}) {
  const { phase } = useSnapshot();
  const { getFactTableById } = useDefinitions();
  const pValueThreshold = usePValueThreshold();
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

  // When experiment is running, always show one additional day at the end of the graph
  if (experimentStatus === "running" && numOfDays >= 7) {
    additionalGraphDataPoints.push({
      d: addDays(new Date(lastDate), 1),
    });
  }

  const lastIndexInvalidConfiguration = timeSeries.dataPoints.findLastIndex(
    (point) =>
      point.tags?.includes("experiment-settings-changed") ||
      point.tags?.includes("metric-settings-changed")
  );

  const dataPoints = [
    ...timeSeries.dataPoints.map((point, idx) => {
      const variations = point.variations.map((i) => {
        // compute adjusted CI if we have all the data and adjustment exists
        // Note: pvalueAdjusted is undefined in the first version of time series
        // so this will not run until we handle adjustment
        let adjustedCI: [number, number] | undefined;
        const pValueAdjusted = i[differenceType]?.pValueAdjusted;
        const lift = i[differenceType]?.expected;
        const ci = i[differenceType]?.ci;
        if (
          pValueAdjusted !== undefined &&
          lift !== undefined &&
          ci !== undefined
        ) {
          adjustedCI = getAdjustedCI(pValueAdjusted, lift, pValueThreshold, ci);
        }

        return {
          users: i.stats?.users,
          v: i[differenceType]?.value ?? 0,
          v_formatted: `${i[differenceType]?.value ?? 0}`,
          up: i[differenceType]?.expected ?? 0,
          ctw: i[differenceType]?.chanceToWin ?? undefined,
          ci: adjustedCI ?? i[differenceType]?.ci ?? undefined,
          p: i[differenceType]?.pValueAdjusted ?? i[differenceType]?.pValue,
          // TODO: What do we do with denominator?
        };
      });
      const parsedPoint: ExperimentTimeSeriesGraphDataPoint = {
        d: new Date(point.date),
        variations: variations,
        helperText:
          idx < lastIndexInvalidConfiguration
            ? "Analysis or metric settings do not match current version"
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
      statsEngine={statsEngine}
      usesPValueAdjustment={pValueAdjustmentEnabled}
    />
  );
}
