import { Flex } from "@radix-ui/themes";
import { DifferenceType, StatsEngine } from "back-end/types/stats";
import { ExperimentStatus } from "back-end/src/validators/experiments";
import { MetricTimeSeries } from "back-end/src/validators/metric-time-series";
import { daysBetween, getValidDate } from "shared/dates";
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
import { useCurrency } from "@/hooks/useCurrency";
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
  firstDateToRender,
}: {
  experimentId: string;
  experimentStatus: ExperimentStatus;
  metric: ExperimentMetricInterface;
  differenceType: DifferenceType;
  showVariations: boolean[];
  statsEngine: StatsEngine;
  pValueAdjustmentEnabled: boolean;
  firstDateToRender: Date;
}) {
  const { phase } = useSnapshot();
  const { getFactTableById } = useDefinitions();
  const pValueThreshold = usePValueThreshold();

  const displayCurrency = useCurrency();
  const formatterOptions = { currency: displayCurrency };
  const metricValueFormatter = getExperimentMetricFormatter(
    metric,
    getFactTableById
  );

  const { data, isLoading, error } = useApi<{ timeSeries: MetricTimeSeries[] }>(
    `/experiments/${experimentId}/time-series?phase=${phase}&metricIds[]=${metric.id}`
  );

  if (error) {
    return (
      <Message>
        An error occurred while loading the time series data. Please try again
        later.
      </Message>
    );
  }

  if (isLoading) {
    return <Message>Loading...</Message>;
  }

  if (!data || data.timeSeries.length === 0) {
    return <Message>No time series data available for this metric.</Message>;
  }

  // Ensure we always render at least 7 days in case we have less than 7 days worth of data
  const additionalGraphDataPoints: ExperimentTimeSeriesGraphDataPoint[] = [];
  const timeSeries = data.timeSeries[0];
  const firstDate = getValidDate(timeSeries.dataPoints[0].date);
  const realFirstDate =
    firstDate < firstDateToRender ? firstDateToRender : firstDate;
  const lastDate = timeSeries.dataPoints[timeSeries.dataPoints.length - 1].date;
  const numOfDays = daysBetween(realFirstDate, lastDate);
  if (numOfDays < 7) {
    additionalGraphDataPoints.push({
      d: addDays(new Date(lastDate), 7 - numOfDays),
    });
  }
  if (firstDateToRender < firstDate) {
    additionalGraphDataPoints.push({
      d: firstDateToRender,
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
          v: i.stats?.mean ?? 0,
          v_formatted: metricValueFormatter(
            i.stats?.mean ?? 0,
            formatterOptions
          ),
          users: i.stats?.users ?? 0,
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
        return "% Change";
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

function Message({ children }: { children: React.ReactNode }) {
  return (
    <Flex
      align="center"
      height="220px"
      justify="center"
      pb="1rem"
      position="relative"
      width="100%"
    >
      {children}
    </Flex>
  );
}
