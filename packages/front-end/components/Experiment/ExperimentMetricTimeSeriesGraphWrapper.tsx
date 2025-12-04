import * as Sentry from "@sentry/nextjs";
import { useMemo } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { Flex } from "@radix-ui/themes";
import { DifferenceType, StatsEngine } from "back-end/types/stats";
import { ExperimentStatus } from "back-end/src/validators/experiments";
import { MetricTimeSeries } from "shared/src/validators/metric-time-series";
import { daysBetween, getValidDate } from "shared/dates";
import { addDays, min } from "date-fns";
import { filterInvalidMetricTimeSeries } from "shared/util";
import { ExperimentMetricInterface, getAdjustedCI } from "shared/experiments";
import useApi from "@/hooks/useApi";
import { useDefinitions } from "@/services/DefinitionsContext";
import {
  getExperimentMetricFormatter,
  formatPercent,
} from "@/services/metrics";
import usePValueThreshold from "@/hooks/usePValueThreshold";
import { useCurrency } from "@/hooks/useCurrency";
import ExperimentTimeSeriesGraph, {
  ExperimentTimeSeriesGraphDataPoint,
} from "./ExperimentTimeSeriesGraph";

interface ExperimentMetricTimeSeriesGraphWrapperProps {
  experimentId: string;
  phase: number;
  experimentStatus: ExperimentStatus;
  metric: ExperimentMetricInterface;
  differenceType: DifferenceType;
  variationNames: string[];
  showVariations: boolean[];
  statsEngine: StatsEngine;
  pValueAdjustmentEnabled: boolean;
  firstDateToRender: Date;
  sliceId?: string;
}

export default function ExperimentMetricTimeSeriesGraphWrapperWithErrorBoundary(
  props: ExperimentMetricTimeSeriesGraphWrapperProps,
) {
  return (
    <ErrorBoundary
      fallback={
        <Message>Something went wrong while displaying this graph.</Message>
      }
      onError={(error) => {
        Sentry.captureException(error);
      }}
    >
      <ExperimentMetricTimeSeriesGraphWrapper {...props} />
    </ErrorBoundary>
  );
}

function ExperimentMetricTimeSeriesGraphWrapper({
  experimentId,
  phase,
  experimentStatus,
  metric,
  differenceType,
  variationNames,
  showVariations,
  statsEngine,
  pValueAdjustmentEnabled,
  firstDateToRender,
  sliceId,
}: ExperimentMetricTimeSeriesGraphWrapperProps) {
  const { getFactTableById } = useDefinitions();
  const pValueThreshold = usePValueThreshold();

  const displayCurrency = useCurrency();
  const formatterOptions = { currency: displayCurrency };
  const metricValueFormatter = getExperimentMetricFormatter(
    metric,
    getFactTableById,
  );

  const metricId = sliceId ?? metric.id;

  const { data, isLoading, error } = useApi<{ timeSeries: MetricTimeSeries[] }>(
    `/experiments/${experimentId}/time-series?phase=${phase}&metricIds[]=${encodeURIComponent(metricId)}`,
  );

  const filteredMetricTimeSeries = useMemo(() => {
    return filterInvalidMetricTimeSeries(data?.timeSeries || []);
  }, [data]);

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

  if (!filteredMetricTimeSeries || filteredMetricTimeSeries.length === 0) {
    return <Message>No time series data available for this metric.</Message>;
  }

  // NB: Can get first item because we only fetch one metric
  const timeSeries = filteredMetricTimeSeries[0];

  const additionalGraphDataPoints: ExperimentTimeSeriesGraphDataPoint[] = [];
  const firstDataPointDate = getValidDate(timeSeries.dataPoints[0].date);
  if (firstDateToRender < firstDataPointDate) {
    additionalGraphDataPoints.push({
      d: firstDateToRender,
    });
  }

  const firstDate = min([firstDateToRender, firstDataPointDate]);
  const lastDataPointDate =
    timeSeries.dataPoints[timeSeries.dataPoints.length - 1].date;
  const numOfDays = daysBetween(firstDate, lastDataPointDate);
  if (numOfDays < 7) {
    additionalGraphDataPoints.push({
      d: addDays(new Date(lastDataPointDate), 7 - numOfDays),
    });
  } else if (experimentStatus === "running") {
    // When experiment is running, always show one additional day at the end of the graph
    additionalGraphDataPoints.push({
      d: addDays(new Date(lastDataPointDate), 1),
    });
  }

  const lastIndexInvalidConfiguration = timeSeries.dataPoints.findLastIndex(
    (point) =>
      point.tags?.includes("experiment-settings-changed") ||
      point.tags?.includes("metric-settings-changed"),
  );

  const dataPoints = [
    ...timeSeries.dataPoints.map((point, idx) => {
      // Preprocess variations to match variationNames order exactly with indices
      const variations = variationNames.map((vName) => {
        const variation = point.variations.find((v) => v.name === vName);
        if (!variation) return null;

        // compute adjusted CI if we have all the data and adjustment exists
        // Note: pvalueAdjusted is undefined in the first version of time series
        // so this will not run until we handle adjustment
        let adjustedCI: [number, number] | undefined;
        const pValueAdjusted = variation[differenceType]?.pValueAdjusted;
        const lift = variation[differenceType]?.expected;
        const ci = variation[differenceType]?.ci;
        if (
          pValueAdjusted !== undefined &&
          lift !== undefined &&
          ci !== undefined
        ) {
          adjustedCI = getAdjustedCI(pValueAdjusted, lift, pValueThreshold, ci);
        }

        return {
          v: variation.stats?.mean ?? 0,
          v_formatted: metricValueFormatter(
            variation.stats?.mean ?? 0,
            formatterOptions,
          ),
          users: variation.stats?.users ?? 0,
          up: variation[differenceType]?.expected ?? 0,
          ctw: variation[differenceType]?.chanceToWin ?? undefined,
          ci: adjustedCI ?? variation[differenceType]?.ci ?? undefined,
          p:
            variation[differenceType]?.pValueAdjusted ??
            variation[differenceType]?.pValue,
        };
      });

      const parsedPoint: ExperimentTimeSeriesGraphDataPoint = {
        d: new Date(point.date),
        variations,
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
              differenceType === "absolute" ? "percentagePoints" : "number",
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
