import React, { useMemo } from "react";
import { Box, Flex } from "@radix-ui/themes";
import type {
  ExplorationConfig,
  ProductAnalyticsExploration,
  ProductAnalyticsResultRow,
} from "shared/validators";
import { getFunnelStepDisplayLabel } from "@/enterprise/components/ProductAnalytics/util";
import { useDefinitions } from "@/services/DefinitionsContext";
import { getPreviewUnitLabel } from "@/components/QueryPreview/previewUtils";
import Text from "@/ui/Text";
import FunnelStepsChart, { FunnelChartSeries } from "./FunnelStepsChart";

function rowsToSeries(
  rows: ProductAnalyticsResultRow[] | undefined,
  stepNames: string[],
): FunnelChartSeries[] {
  if (!rows?.length || !stepNames.length) return [];
  return rows.map((row) => {
    const steps = row.steps ?? [];
    const key = row.dimensions[0] ?? "";
    return {
      key,
      label: key || "All users",
      counts: stepNames.map((_, i) => steps[i]?.count ?? 0),
      avgTimes: stepNames.map((_, i) => {
        const s = steps[i];
        if (!s || !s.timeFromPrevSumHrs || !s.count) return null;
        return (s.timeFromPrevSumHrs / s.count) * 3_600_000;
      }),
    };
  });
}

export default function FunnelChart({
  exploration,
  comparisonExploration = null,
  periodLabels = null,
  submittedExploreState,
  animate = true,
  compact = false,
}: {
  exploration: ProductAnalyticsExploration | null;
  comparisonExploration?: ProductAnalyticsExploration | null;
  periodLabels?: { currentLabel: string; previousLabel: string } | null;
  submittedExploreState: ExplorationConfig;
  animate?: boolean;
  compact?: boolean;
}) {
  const { getFactTableById } = useDefinitions();

  // Step labels: when the user hasn't renamed the step from the default
  // "Step N", substitute the filter preview (e.g. `event_name=Purchase`,
  // or just `Purchase` when `event_name=` is the universal context across
  // every step) so chart axes communicate what each step actually is.
  const stepNames = useMemo(() => {
    if (submittedExploreState.dataset.type !== "funnel") return [];
    const allSteps = submittedExploreState.dataset.steps;
    return allSteps.map((s, i) =>
      getFunnelStepDisplayLabel({
        step: s,
        factTable: s.factTableId ? getFactTableById(s.factTableId) : null,
        fallbackIndex: i,
        allSteps,
      }),
    );
  }, [submittedExploreState, getFactTableById]);

  const sortedSeries: FunnelChartSeries[] = useMemo(
    // Sort by first-step count descending so the biggest funnel shows up first.
    () =>
      rowsToSeries(exploration?.result?.rows, stepNames).sort(
        (a, b) => (b.counts[0] ?? 0) - (a.counts[0] ?? 0),
      ),
    [exploration?.result?.rows, stepNames],
  );

  // Previous period, in the same order as `sortedSeries`. A breakdown value
  // missing from the previous period gets an all-zero funnel.
  const comparisonSeries: FunnelChartSeries[] | null = useMemo(() => {
    const rows = comparisonExploration?.result?.rows;
    if (!rows?.length) return null;
    const byKey = new Map(rowsToSeries(rows, stepNames).map((s) => [s.key, s]));
    return sortedSeries.map(
      (s) =>
        byKey.get(s.key) ?? {
          ...s,
          counts: s.counts.map(() => 0),
          avgTimes: s.avgTimes.map(() => null),
        },
    );
  }, [comparisonExploration?.result?.rows, stepNames, sortedSeries]);

  // Y-axis scaling: "percent" normalizes each series so step 1 = 100%,
  // surfacing per-dimension conversion rates directly. "count" preserves
  // raw user counts. Default to "percent" when the config field is unset
  // (back-compat with explorations saved before this option existed).
  const yAxisScale: "count" | "percent" =
    submittedExploreState.dataset.type === "funnel"
      ? (submittedExploreState.dataset.yAxisScale ?? "percent")
      : "count";

  if (!exploration || !stepNames.length) {
    return (
      <Flex
        p="4"
        style={{ flex: 1, minHeight: 0 }}
        align="center"
        justify="center"
      >
        <Text color="text-mid" weight="medium">
          Configure at least two funnel steps to see results.
        </Text>
      </Flex>
    );
  }

  if (!sortedSeries.length) {
    return (
      <Flex
        p="4"
        style={{ flex: 1, minHeight: 0 }}
        align="center"
        justify="center"
      >
        <Text color="text-mid" weight="medium">
          The query ran successfully, but no data was returned.
        </Text>
      </Flex>
    );
  }

  const chart = (
    <FunnelStepsChart
      stepLabels={stepNames}
      series={sortedSeries}
      comparison={
        comparisonSeries && periodLabels
          ? { series: comparisonSeries, ...periodLabels }
          : undefined
      }
      yAxisScale={yAxisScale}
      animate={animate}
    />
  );

  if (!compact) return chart;

  // Metric previews have no breakdown, so this row covers the whole funnel.
  const counts = sortedSeries[0].counts;
  const entered = counts[0];
  const completed = counts[counts.length - 1];
  const dataset = submittedExploreState.dataset;
  const unitLabel =
    dataset.type === "funnel" && dataset.unit
      ? getPreviewUnitLabel(
          dataset.unit,
          getFactTableById(dataset.steps[0]?.factTableId ?? ""),
        ).label.toLowerCase()
      : "users";

  return (
    <Flex direction="column" gap="2" width="100%" minWidth="0">
      {submittedExploreState.dimensions.length === 0 && (
        <Box>
          <div style={{ fontSize: "3rem", lineHeight: 1.2, fontWeight: 600 }}>
            {entered > 0 ? `${((completed / entered) * 100).toFixed(1)}%` : "—"}
          </div>
          <Text as="div" size="sm" color="text-mid">
            Overall funnel completion rate
          </Text>
          <Text as="div" size="sm" color="text-mid">
            {completed.toLocaleString()} of {entered.toLocaleString()}{" "}
            {unitLabel}
          </Text>
        </Box>
      )}
      <Flex height="280px" flexShrink="0" minWidth="0">
        {chart}
      </Flex>
    </Flex>
  );
}
