import { captureException as sentryCaptureException } from "@sentry/nextjs";
import { useMemo } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { Flex } from "@radix-ui/themes";
import { DifferenceType, StatsEngine } from "shared/types/stats";
import {
  MetricTimeSeries,
  type MetricTimeSeriesVariation,
} from "shared/validators";
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
import { useCurrency } from "@/hooks/useCurrency";
import { GraphVariation } from "./ExperimentDateGraph";
import ExperimentTimeSeriesGraph, {
  DataPointVariation,
  ExperimentTimeSeriesGraphDataPoint,
} from "./ExperimentTimeSeriesGraph";

function getLiftSlice(
  variation: MetricTimeSeriesVariation,
  preferred: DifferenceType,
) {
  return (
    variation[preferred] ??
    variation.absolute ??
    variation.relative ??
    variation.scaled
  );
}

/** Prefer `preferred`, else first slice that exists (safe-rollout series often only have `absolute`). */
function inferDisplayedDifferenceType(
  variation: MetricTimeSeriesVariation | undefined,
  preferred: DifferenceType,
): DifferenceType {
  if (!variation) return preferred;
  if (variation[preferred]) return preferred;
  if (variation.absolute) return "absolute";
  if (variation.relative) return "relative";
  if (variation.scaled) return "scaled";
  return preferred;
}

function mapTimeSeriesPointToVariationCells({
  point,
  variations,
  differenceType,
  metricValueFormatter,
  formatterOptions,
  pValueThreshold,
}: {
  point: MetricTimeSeries["dataPoints"][number];
  variations: GraphVariation[];
  differenceType: DifferenceType;
  metricValueFormatter: ReturnType<typeof getExperimentMetricFormatter>;
  formatterOptions: { currency: string };
  pValueThreshold: number;
}): (DataPointVariation | null)[] {
  return variations.map((gv) => {
    const variation = point.variations.find((v) => v.name === gv.name);
    if (!variation) return null;

    const liftSlice = getLiftSlice(variation, differenceType);

    let adjustedCI: [number, number] | undefined;
    const pValueAdjusted = liftSlice?.pValueAdjusted;
    const lift = liftSlice?.expected;
    const ci = liftSlice?.ci;
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
      up: liftSlice?.expected ?? 0,
      ctw: liftSlice?.chanceToWin ?? undefined,
      ci: adjustedCI ?? liftSlice?.ci ?? undefined,
      p: liftSlice?.pValueAdjusted ?? liftSlice?.pValue,
    };
  });
}

/** Flat effect = 0 before the first measured point (no lift yet vs baseline). */
function buildZeroEffectPadPoint(
  d: Date,
  templateCells: (DataPointVariation | null)[],
): ExperimentTimeSeriesGraphDataPoint {
  return {
    d,
    isPaddingPoint: true,
    variations: templateCells.map((cell) => {
      if (!cell) return null;
      return {
        ...cell,
        up: 0,
        ci: undefined,
        p: undefined,
        ctw: undefined,
      };
    }),
  };
}

interface ExperimentMetricTimeSeriesGraphWrapperProps {
  experimentId: string;
  pValueThreshold: number;
  phase: number;
  metric: ExperimentMetricInterface;
  differenceType: DifferenceType;
  variations: GraphVariation[];
  showVariations: boolean[];
  statsEngine: StatsEngine;
  pValueAdjustmentEnabled: boolean;
  firstDateToRender: Date;
  sliceId?: string;
  baselineRow?: number;
  unavailableMessage?: string;
  preloadedTimeSeries?: MetricTimeSeries;
  dimensionId?: string;
  dimensionValue?: string;
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
        sentryCaptureException(error);
      }}
    >
      <ExperimentMetricTimeSeriesGraphWrapper {...props} />
    </ErrorBoundary>
  );
}

function ExperimentMetricTimeSeriesGraphWrapper({
  experimentId,
  pValueThreshold,
  phase,
  metric,
  differenceType,
  variations,
  showVariations,
  statsEngine,
  pValueAdjustmentEnabled,
  firstDateToRender,
  sliceId,
  baselineRow = 0,
  unavailableMessage,
  preloadedTimeSeries,
  dimensionId,
  dimensionValue,
}: ExperimentMetricTimeSeriesGraphWrapperProps) {
  const { getFactTableById } = useDefinitions();

  const displayCurrency = useCurrency();
  const formatterOptions = { currency: displayCurrency };
  const metricValueFormatter = getExperimentMetricFormatter(
    metric,
    getFactTableById,
  );

  const metricId = sliceId ?? metric.id;
  const dimensionQuery =
    dimensionId && dimensionValue !== undefined
      ? `&dimensions[0][id]=${encodeURIComponent(
          dimensionId,
        )}&dimensions[0][value]=${encodeURIComponent(dimensionValue)}`
      : dimensionId
        ? `&dimensions[0][id]=${encodeURIComponent(dimensionId)}`
        : "";

  const { data, isLoading, error } = useApi<{ timeSeries: MetricTimeSeries[] }>(
    `/experiments/${experimentId}/time-series?phase=${phase}&metricIds[]=${encodeURIComponent(metricId)}${dimensionQuery}`,
    { shouldRun: () => !preloadedTimeSeries },
  );

  const filteredMetricTimeSeries = useMemo(() => {
    if (preloadedTimeSeries) return [preloadedTimeSeries];
    const all = filterInvalidMetricTimeSeries(data?.timeSeries || []);
    if (!dimensionId) {
      return all.filter((t) => !t.dimensionId);
    }
    if (dimensionValue === undefined) {
      return all.filter((t) => t.dimensionId === dimensionId);
    }
    return all.filter(
      (t) =>
        t.dimensionId === dimensionId && t.dimensionValue === dimensionValue,
    );
  }, [data, preloadedTimeSeries, dimensionId, dimensionValue]);

  if (unavailableMessage) {
    return <Message height="70px">{unavailableMessage}</Message>;
  }

  if (baselineRow !== 0) {
    return (
      <Message>
        Time series is only available when comparing against Control as a
        baseline.
      </Message>
    );
  }

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

  if (!timeSeries.dataPoints?.length) {
    return <Message>No time series data available for this metric.</Message>;
  }

  const probeVariation =
    timeSeries.dataPoints[0]?.variations?.find((_, i) => i > 0) ??
    timeSeries.dataPoints[0]?.variations?.[1];
  const displayDifferenceType = inferDisplayedDifferenceType(
    probeVariation,
    differenceType,
  );

  const additionalGraphDataPoints: ExperimentTimeSeriesGraphDataPoint[] = [];
  const firstDataPointDate = getValidDate(timeSeries.dataPoints[0].date);

  const lastIndexInvalidConfiguration = timeSeries.dataPoints.findLastIndex(
    (point) =>
      point.tags?.includes("experiment-settings-changed") ||
      point.tags?.includes("metric-settings-changed"),
  );

  const firstPointTemplateCells = mapTimeSeriesPointToVariationCells({
    point: timeSeries.dataPoints[0],
    variations,
    differenceType,
    metricValueFormatter,
    formatterOptions,
    pValueThreshold,
  });

  const preRolloutPadPoints: ExperimentTimeSeriesGraphDataPoint[] = [];
  if (firstDateToRender.getTime() < firstDataPointDate.getTime()) {
    preRolloutPadPoints.push(
      buildZeroEffectPadPoint(firstDateToRender, firstPointTemplateCells),
    );
    const padEnd = new Date(firstDataPointDate.getTime() - 1);
    if (padEnd.getTime() > firstDateToRender.getTime()) {
      preRolloutPadPoints.push(
        buildZeroEffectPadPoint(padEnd, firstPointTemplateCells),
      );
    }
  }

  const firstDate = min([firstDateToRender, firstDataPointDate]);
  const lastDataPointDate =
    timeSeries.dataPoints[timeSeries.dataPoints.length - 1].date;
  if (!preloadedTimeSeries) {
    const numOfDays = daysBetween(firstDate, lastDataPointDate);
    if (numOfDays < 7) {
      additionalGraphDataPoints.push({
        d: addDays(new Date(lastDataPointDate), 7 - numOfDays),
      });
    } else {
      // Always show one additional day at the end of the graph
      additionalGraphDataPoints.push({
        d: addDays(new Date(lastDataPointDate), 1),
      });
    }
  }

  const dataPoints = [
    ...preRolloutPadPoints,
    ...timeSeries.dataPoints.map((point, idx) => {
      const pointVariations = mapTimeSeriesPointToVariationCells({
        point,
        variations,
        differenceType,
        metricValueFormatter,
        formatterOptions,
        pValueThreshold,
      });

      const parsedPoint: ExperimentTimeSeriesGraphDataPoint = {
        d: new Date(point.date),
        variations: pointVariations,
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
    switch (displayDifferenceType) {
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
      variations={variations}
      label={labelText}
      datapoints={dataPoints}
      showVariations={showVariations}
      formatter={
        displayDifferenceType === "relative"
          ? formatPercent
          : getExperimentMetricFormatter(
              metric,
              getFactTableById,
              displayDifferenceType === "absolute"
                ? "percentagePoints"
                : "number",
            )
      }
      statsEngine={statsEngine}
      usesPValueAdjustment={pValueAdjustmentEnabled}
    />
  );
}

function Message({
  children,
  height = "220px",
}: {
  children: React.ReactNode;
  height?: string;
}) {
  return (
    <Flex
      align="center"
      height={height}
      justify="center"
      mb="-1rem"
      position="relative"
      width="100%"
    >
      {children}
    </Flex>
  );
}
