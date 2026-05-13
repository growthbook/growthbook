import { useEffect, useMemo, useRef } from "react";
import { Box, Flex } from "@radix-ui/themes";
import EChartsReact from "echarts-for-react";
import * as echarts from "echarts/core";
import type {
  ExplorationConfig,
  ProductAnalyticsExploration,
} from "shared/validators";
import { isManagedWarehousePendingQueryError } from "shared/util";
import {
  calculateProductAnalyticsDateRange,
  getDateGranularity,
} from "shared/enterprise";
import {
  shouldChartSectionShow,
  getEffectiveMetricValue,
  computeDimensionTotals,
  getIsRatioByIndex,
  getEffectiveShowAs,
  getSharedUnit,
  showAsAppliesTo,
  formatDateByGranularity,
  type ResolvedGranularity,
  type RenderOpts,
} from "@/enterprise/components/ProductAnalytics/util";
import { useAppearanceUITheme } from "@/services/AppearanceUIThemeProvider";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useDashboardCharts } from "@/enterprise/components/Dashboards/DashboardChartsContext";
import BigValueChart from "@/components/SqlExplorer/BigValueChart";
import HelperText from "@/ui/HelperText";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";
import ManagedWarehouseNoEventsCallout from "@/components/ManagedWarehouse/ManagedWarehouseNoEventsCallout";
import {
  buildAlignedComparisonOverlayForExplorer,
  buildComparisonOverlaySeriesMaps,
  buildExplorerChartComparisonSeriesList,
  buildIndividualBarComparePivotSeriesAndCategories,
  computeBigNumberComparisonTrend,
  getComparisonPeriodLabels,
  supportsAlwaysOnComparisonOverlay,
} from "@/enterprise/components/ProductAnalytics/compareUtil";
import ComparisonTrendLabel from "@/enterprise/components/ProductAnalytics/ComparisonTrendLabel";

const CHART_ID = "explorer-chart";

const CHART_COLORS = [
  "#8b5cf6",
  "#3b82f6",
  "#06b6d4",
  "#22c55e",
  "#eab308",
  "#f97316",
  "#ef4444",
  "#ec4899",
  "#6b7280",
];

const COMPARISON_SERIES_COLORS = [
  "#d97706",
  "#a8a29e",
  "#fbbf24",
  "#9ca3af",
  "#78716c",
];

// Simple number formatter
function formatNumber(value: number): string {
  if (Math.abs(value) >= 1000000) {
    return `${(value / 1000000).toFixed(2)}M`;
  } else if (Math.abs(value) >= 1000) {
    return `${(value / 1000).toFixed(1)}K`;
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export default function ExplorerChart({
  exploration,
  comparisonExploration = null,
  compareEnabled = false,
  error,
  submittedExploreState,
  loading,
  animate = true,
}: {
  exploration: ProductAnalyticsExploration | null;
  comparisonExploration?: ProductAnalyticsExploration | null;
  compareEnabled?: boolean;
  error: string | null;
  submittedExploreState: ExplorationConfig;
  loading: boolean;
  /** When false, ECharts entry animations are disabled (e.g. for already-seen charts). */
  animate?: boolean;
}) {
  const { theme } = useAppearanceUITheme();
  const textColor = theme === "dark" ? "#FFFFFF" : "#1F2D5C";
  const tooltipBackgroundColor = theme === "dark" ? "#1c2339" : "#FFFFFF";
  const gridLineColor =
    theme === "dark" ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.06)";
  const chartsContext = useDashboardCharts();
  const { getFactMetricById } = useDefinitions();

  // ECharts only auto-resizes on window resize, not when its parent container
  // changes (e.g. a dashboard block being resized via react-grid-layout or the
  // editing drawer collapsing). Observe the wrapper and call resize() so the
  // chart always fills its block.
  const chartWrapperRef = useRef<HTMLDivElement | null>(null);
  const chartInstanceRef = useRef<echarts.ECharts | null>(null);
  useEffect(() => {
    const el = chartWrapperRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const chart = chartInstanceRef.current;
      if (!chart || chart.isDisposed()) return;
      chart.resize();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const renderOpts: RenderOpts = useMemo(
    () => ({
      showAs: getEffectiveShowAs(submittedExploreState, getFactMetricById),
      isRatioByIndex: getIsRatioByIndex(
        submittedExploreState,
        getFactMetricById,
      ),
    }),
    [submittedExploreState, getFactMetricById],
  );

  // Y-axis label: reflects whether we're rendering raw totals or per-unit
  // averages. Only populated when showAs applies (otherwise the toggle is
  // hidden and the number's meaning is carried by the metric/series name).
  const valueAxisName = useMemo(() => {
    if (!showAsAppliesTo(submittedExploreState, getFactMetricById)) return "";
    if (renderOpts.showAs === "total") return "Total";
    const sharedUnit = getSharedUnit(submittedExploreState);
    return sharedUnit ? `Per ${sharedUnit}` : "Per unit";
  }, [submittedExploreState, getFactMetricById, renderOpts.showAs]);

  const bigNumberComparisonTrend = useMemo(() => {
    if (!compareEnabled) return null;
    return computeBigNumberComparisonTrend(
      exploration,
      comparisonExploration,
      submittedExploreState,
      getFactMetricById,
    );
  }, [
    compareEnabled,
    exploration,
    comparisonExploration,
    submittedExploreState,
    getFactMetricById,
  ]);

  // Transform ProductAnalyticsResult + exploreState to ECharts format
  const chartConfig = useMemo(() => {
    if (
      !exploration?.result?.rows?.length ||
      !submittedExploreState ||
      ["table", "timeseries-table"].includes(submittedExploreState.chartType)
    )
      return null;
    const rows = exploration.result.rows;

    // Resolve date granularity for tooltip formatting
    const dateDimension = submittedExploreState.dimensions?.find(
      (d) => d.dimensionType === "date",
    );
    const resolvedGranularity: ResolvedGranularity | null = dateDimension
      ? getDateGranularity(
          dateDimension.dateGranularity,
          calculateProductAnalyticsDateRange(submittedExploreState.dateRange),
        )
      : null;
    const chartType = submittedExploreState.chartType;
    const firstDimensionIsDate =
      submittedExploreState.dimensions?.[0]?.dimensionType === "date";
    const isHorizontalBar =
      chartType === "horizontalBar" || chartType === "stackedHorizontalBar";
    const isStacked =
      chartType === "stackedBar" || chartType === "stackedHorizontalBar";

    if (chartType === "bigNumber") {
      const firstValue = rows[0]?.values[0];
      const value = firstValue
        ? getEffectiveMetricValue(firstValue, {
            showAs: renderOpts.showAs,
            isRatio: renderOpts.isRatioByIndex[0] ?? false,
          })
        : 0;
      return { type: "bigNumber" as const, value };
    }

    const { uniqueXValues, dataMap, seriesMeta } =
      buildComparisonOverlaySeriesMaps(rows, submittedExploreState, renderOpts);

    const numMetrics = submittedExploreState?.dataset?.values?.length ?? 0;
    const numDimensions = submittedExploreState?.dimensions?.length ?? 0;

    // 2. Compute cumulative totals for sorting
    const seriesTotals: Record<string, number> = {};
    for (const [seriesKey, seriesData] of Object.entries(dataMap)) {
      seriesTotals[seriesKey] = Object.values(seriesData).reduce(
        (sum, v) => sum + v,
        0,
      );
    }
    const sortedSeriesKeys = Object.keys(dataMap).sort(
      (a, b) => seriesTotals[b] - seriesTotals[a],
    );

    const isBarType = [
      "bar",
      "stackedBar",
      "stackedHorizontalBar",
      "horizontalBar",
    ].includes(chartType);

    // Bar charts: sort categories by total value; timeseries: chronological
    let sortedXValues: string[];
    if (isBarType) {
      const xValueTotals = computeDimensionTotals(rows, 0, renderOpts);
      // Horizontal bars render bottom-to-top, so sort ascending for largest on top
      sortedXValues = Array.from(uniqueXValues).sort((a, b) =>
        isHorizontalBar
          ? xValueTotals[a] - xValueTotals[b]
          : xValueTotals[b] - xValueTotals[a],
      );
    } else {
      sortedXValues = Array.from(uniqueXValues).sort();
    }

    // 3. Build Series (ordered by cumulative total, highest first)
    const seriesColor = (i: number) => CHART_COLORS[i % CHART_COLORS.length];
    const comparisonSeriesColor = (i: number) =>
      COMPARISON_SERIES_COLORS[i % COMPARISON_SERIES_COLORS.length];

    const compareOverlayActive =
      compareEnabled &&
      Boolean(comparisonExploration?.result?.rows?.length) &&
      supportsAlwaysOnComparisonOverlay(chartType);
    const comparisonPeriodLabels = compareOverlayActive
      ? getComparisonPeriodLabels(submittedExploreState.dateRange)
      : null;

    const alignedComparisonDataForCurrent =
      compareOverlayActive && comparisonExploration?.result?.rows?.length
        ? buildAlignedComparisonOverlayForExplorer({
            sortedXValues,
            comparisonRows: comparisonExploration.result.rows,
            submittedExploreState,
            renderOpts,
            sortedSeriesKeys,
            firstDimensionIsDate,
          })
        : null;

    const individualBarComparePivot =
      compareOverlayActive &&
      !isStacked &&
      (chartType === "bar" || chartType === "horizontalBar") &&
      alignedComparisonDataForCurrent &&
      comparisonPeriodLabels
        ? buildIndividualBarComparePivotSeriesAndCategories({
            sortedXValues,
            sortedSeriesKeys,
            dataMap,
            previousAlignedMap: alignedComparisonDataForCurrent,
            sourceSeriesMeta: seriesMeta,
            comparisonPeriodLabels,
            seriesColor,
            comparisonSeriesColor,
            animate,
          })
        : null;

    let seriesConfigs: unknown[];
    const categoryAxisData = individualBarComparePivot
      ? individualBarComparePivot.categoryAxisData
      : sortedXValues;

    if (individualBarComparePivot) {
      seriesConfigs = individualBarComparePivot.series;
    } else {
      seriesConfigs = buildExplorerChartComparisonSeriesList({
        chartType,
        sourceDataMap: dataMap,
        sourceSeriesMeta: seriesMeta,
        sourceSeriesKeys: sortedSeriesKeys,
        sourceSortedXValues: sortedXValues,
        numMetrics,
        numDimensions,
        isStacked,
        compareOverlayActive,
        comparisonPeriodLabels,
        seriesColor,
        comparisonSeriesColor,
        animate,
      });

      if (compareOverlayActive && alignedComparisonDataForCurrent) {
        seriesConfigs = [
          ...seriesConfigs,
          ...buildExplorerChartComparisonSeriesList({
            chartType,
            sourceDataMap: alignedComparisonDataForCurrent,
            sourceSeriesMeta: seriesMeta,
            sourceSeriesKeys: sortedSeriesKeys,
            sourceSortedXValues: sortedXValues,
            numMetrics,
            numDimensions,
            isStacked,
            compareOverlayActive,
            comparisonPeriodLabels,
            previous: true,
            seriesColor,
            comparisonSeriesColor,
            animate,
          }),
        ];
      }
    }

    const axisPointerLabelFormatter =
      individualBarComparePivot && resolvedGranularity && firstDimensionIsDate
        ? (params: { value: string | number }) => {
            const raw = String(params.value);
            const firstLine = raw.split("\n")[0] ?? raw;
            const date = new Date(firstLine);
            if (Number.isNaN(date.getTime())) return raw;
            return formatDateByGranularity(date, resolvedGranularity);
          }
        : resolvedGranularity
          ? (params: { value: string | number }) => {
              const date =
                typeof params.value === "number"
                  ? new Date(params.value)
                  : new Date(String(params.value));
              return formatDateByGranularity(date, resolvedGranularity);
            }
          : undefined;

    // Define the category axis (shows the dimension labels)
    const categoryAxis = {
      type: chartType === "line" || chartType === "area" ? "time" : "category",
      data: categoryAxisData,
      nameLocation: "middle" as const,
      nameTextStyle: {
        fontSize: 14,
        fontWeight: "bold",
        padding: [10, 0],
        color: textColor,
      },
      axisLabel: {
        color: textColor,
        rotate: isHorizontalBar ? 0 : -45,
        hideOverlap: true,
        ...(individualBarComparePivot
          ? {
              formatter: (value: string) => {
                const lines = String(value).split("\n");
                if (lines.length < 2) return value;
                const [dimVal, ...attrParts] = lines;
                const attr = attrParts.join("\n");
                if (firstDimensionIsDate && resolvedGranularity) {
                  const d = new Date(dimVal);
                  if (!Number.isNaN(d.getTime())) {
                    return `${formatDateByGranularity(d, resolvedGranularity)}\n${attr}`;
                  }
                }
                return `${dimVal}\n${attr}`;
              },
            }
          : {}),
      },
      // Only attach the axisPointer key when we actually have a formatter to
      // apply. Setting `axisPointer: undefined` overwrites ECharts' default
      ...(axisPointerLabelFormatter
        ? {
            axisPointer: {
              label: { formatter: axisPointerLabelFormatter },
            },
          }
        : {}),
      splitLine: { lineStyle: { color: gridLineColor, width: 1 } },
    };

    // Define the value axis (shows the numeric values)
    const valueAxis = {
      type: "value" as const,
      scale: false,
      name: valueAxisName,
      nameLocation: "middle" as const,
      nameGap: 50,
      nameTextStyle: {
        fontSize: 14,
        fontWeight: "bold",
        padding: [40, 0],
        color: textColor,
      },
      axisLabel: { color: textColor, formatter: formatNumber },
      splitLine: { lineStyle: { color: gridLineColor, width: 1 } },
    };

    // Swap axes for horizontal bar
    const xAxis = isHorizontalBar ? valueAxis : categoryAxis;
    const yAxis = isHorizontalBar ? categoryAxis : valueAxis;

    // Build a custom tooltip formatter: pivot compare bars (dimension + attribute
    // header), timeseries (granularity-aware date), or default ECharts tooltip.
    const tooltipFormatter = individualBarComparePivot
      ? (params: unknown) => {
          const items = (Array.isArray(params) ? params : [params]) as {
            axisValue: string | number;
            dataIndex: number;
            marker: string;
            seriesName: string;
            value: number | [number, number];
          }[];
          if (!items.length) return "";
          const idx =
            typeof items[0].dataIndex === "number" ? items[0].dataIndex : 0;
          const slot = individualBarComparePivot.slots[idx];
          if (!slot) return "";

          const dimHeader =
            firstDimensionIsDate && resolvedGranularity
              ? (() => {
                  const d = new Date(slot.x);
                  return Number.isNaN(d.getTime())
                    ? slot.x
                    : formatDateByGranularity(d, resolvedGranularity);
                })()
              : slot.x;

          const header = `<div style="margin-bottom:4px"><div>${dimHeader}</div><div style="font-size:12px;opacity:0.9">${slot.attributeName}</div></div>`;

          const seriesRows = items
            .map((item) => {
              const numValue = Array.isArray(item.value)
                ? item.value[1]
                : item.value;
              const formatted =
                typeof numValue === "number"
                  ? formatNumber(numValue)
                  : String(numValue);
              return `<div style="display:flex;justify-content:space-between;gap:16px"><span>${item.marker}${item.seriesName}</span><span><b>${formatted}</b></span></div>`;
            })
            .join("");

          return `<div>${header}${seriesRows}</div>`;
        }
      : resolvedGranularity
        ? (params: unknown) => {
            const items = (Array.isArray(params) ? params : [params]) as {
              axisValue: string | number;
              marker: string;
              seriesName: string;
              value: number | [number, number];
            }[];
            if (!items.length) return "";

            // axisValue is a timestamp (ms) for time axis, raw string for category axis
            const rawAxisValue = items[0].axisValue;
            const date =
              typeof rawAxisValue === "number"
                ? new Date(rawAxisValue)
                : new Date(String(rawAxisValue));
            const header = formatDateByGranularity(date, resolvedGranularity);

            const seriesRows = items
              .map((item) => {
                const numValue = Array.isArray(item.value)
                  ? item.value[1]
                  : item.value;
                const formatted =
                  typeof numValue === "number"
                    ? formatNumber(numValue)
                    : String(numValue);
                return `<div style="display:flex;justify-content:space-between;gap:16px"><span>${item.marker}${item.seriesName}</span><span><b>${formatted}</b></span></div>`;
              })
              .join("");

            return `<div><div style="margin-bottom:4px">${header}</div>${seriesRows}</div>`;
          }
        : undefined;

    return {
      tooltip: {
        appendTo: "body",
        trigger: "axis",
        padding: [10, 14],
        backgroundColor: tooltipBackgroundColor,
        textStyle: { color: textColor },
        axisPointer: {
          type: [
            "bar",
            "stackedBar",
            "stackedHorizontalBar",
            "horizontalBar",
          ].includes(chartType)
            ? "shadow"
            : "cross",
        },
        formatter: tooltipFormatter,
      },
      legend: {
        show: seriesConfigs.length > 1,
        top: 8,
        padding: [8, 0, 8, 0],
        textStyle: { color: textColor },
        type: "scroll",
      },
      xAxis,
      yAxis,
      series: seriesConfigs,
    };
  }, [
    exploration?.result?.rows,
    comparisonExploration?.result?.rows,
    compareEnabled,
    submittedExploreState,
    renderOpts,
    textColor,
    gridLineColor,
    tooltipBackgroundColor,
    animate,
    valueAxisName,
  ]);

  const hasEmptyData = useMemo(() => {
    if (!exploration?.result?.rows?.length) return true;
    return exploration.result.rows.every((r) => r.values.length === 0);
  }, [exploration?.result?.rows]);

  if (
    !shouldChartSectionShow({
      loading,
      error,
      submittedExploreState,
    })
  )
    return null;

  return (
    <Flex
      direction="column"
      position="relative"
      style={{
        border: "1px solid var(--gray-a3)",
        borderRadius: "var(--radius-4)",
        flex: 1,
        minHeight: 0,
      }}
    >
      {error ? (
        <Box p="4">
          {isManagedWarehousePendingQueryError(error) ? (
            <ManagedWarehouseNoEventsCallout />
          ) : (
            <Callout status="error">{error}</Callout>
          )}
        </Box>
      ) : !exploration ? (
        <Flex
          p="4"
          style={{ textAlign: "center", flex: 1, minHeight: 0 }}
          align="center"
          justify="center"
        >
          <Text color="text-mid" weight="medium">
            No data available. Select a metric to see results.
          </Text>
        </Flex>
      ) : hasEmptyData ? (
        <Flex
          p="4"
          style={{ textAlign: "center", flex: 1, minHeight: 0 }}
          align="center"
          justify="center"
        >
          <Text color="text-mid" weight="medium">
            The query ran successfully, but no data was returned.
          </Text>
        </Flex>
      ) : chartConfig?.type === "bigNumber" ? (
        <Flex style={{ flex: 1, minHeight: 0 }} align="center" justify="center">
          <BigValueChart
            value={chartConfig.value}
            formatter={formatNumber}
            label={submittedExploreState?.dataset?.values?.[0]?.name}
            compareSlot={
              bigNumberComparisonTrend ? (
                <ComparisonTrendLabel
                  trend={bigNumberComparisonTrend}
                  priorValueScale={0.5}
                />
              ) : undefined
            }
          />
        </Flex>
      ) : chartConfig ? (
        <Box
          ref={chartWrapperRef}
          style={{ flex: 1, minHeight: 0, position: "relative" }}
        >
          <EChartsReact
            key={JSON.stringify(chartConfig)}
            option={{
              ...chartConfig,
              ...(animate ? {} : { animation: false }),
              padding: [0, 0, 0, 0],
              grid: {
                left:
                  submittedExploreState?.chartType === "horizontalBar" ||
                  submittedExploreState?.chartType === "stackedHorizontalBar"
                    ? "10%"
                    : "8%",
                right: "5%",
                top: chartConfig.legend?.show ? 52 : "8%",
                bottom: "10%",
              },
            }}
            style={{ width: "100%", height: "100%" }}
            onChartReady={(chart) => {
              chartInstanceRef.current = chart ?? null;
              if (chartsContext && chart) {
                chartsContext.registerChart(CHART_ID, chart);
              }
            }}
          />
        </Box>
      ) : (
        <Box p="4" style={{ textAlign: "center" }}>
          <HelperText status="error">Unknown chart type</HelperText>
        </Box>
      )}
    </Flex>
  );
}
