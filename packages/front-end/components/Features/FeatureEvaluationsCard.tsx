import { useState } from "react";
import { Box, Flex, SegmentedControl } from "@radix-ui/themes";
import type {
  FeatureUsageDimension,
  FeatureUsageRowsByDimension,
  FeatureUsageRowsMeta,
} from "shared/types/feature";
import type { DataVizConfig } from "shared/validators";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Frame from "@/ui/Frame";
import { DataVisualizationDisplay } from "@/components/DataViz/SqlExplorerDataVisualization";
import { CHART_COLORS } from "@/enterprise/components/ProductAnalytics/chart-theme";
import styles from "./FeatureEvaluationsCard.module.scss";

/**
 * Never tabs: all four render the same population with a different grouping,
 * so there is nothing to switch panels between. Radix's SegmentedControl is
 * built on ToggleGroup `type="single"`, which gives items `role="radio"` and
 * `aria-checked` — the semantics this actually has.
 */
const GROUP_BY_OPTIONS: { id: FeatureUsageDimension; label: string }[] = [
  { id: "value", label: "Value" },
  { id: "source", label: "Source" },
  { id: "ruleId", label: "Rule" },
  { id: "environment", label: "Environment" },
];

/**
 * Must exceed the number of groups the API can send, so the chart never folds
 * a second time.
 *
 * The API already folds each dimension to 25 groups plus one "(other)" row,
 * with exact disclosure. DataVisualizationDisplay uses the *same* "(other)"
 * literal for its own overflow bucket, so a re-fold would quietly absorb the
 * API's bucket into the chart's: the sum would survive, but the difference
 * between "the warehouse truncated this" and "the chart is drawing fewer
 * series" would not. Its fold only triggers past `maxValues + 1`, so 26 clears
 * the 26 groups that can arrive.
 */
const MAX_DIMENSION_VALUES = 26;

/**
 * Validated pair for the boolean Value grouping: violet plus a neutral, at CVD
 * ΔE 18.3 with both clearing 3:1. Deliberately NOT CHART_COLORS[0..1] — two
 * saturated hues read as two categories, when this is one thing that is either
 * on or off.
 */
const BOOLEAN_SERIES_COLORS: Record<string, string> = {
  true: "#6e56cf",
  false: "#8b8da3",
};

/**
 * Colour by group name, so a series keeps its colour no matter where the sort
 * puts it. Every dimension except Value takes the house categorical palette;
 * names are sorted first so the assignment is stable across reloads.
 */
function buildSeriesColors(
  dimension: FeatureUsageDimension,
  rows: { group: string }[],
): Record<string, string> {
  if (dimension === "value") return BOOLEAN_SERIES_COLORS;
  const groups = [...new Set(rows.map((r) => r.group))].sort((a, b) =>
    a.localeCompare(b),
  );
  return Object.fromEntries(
    groups.map((group, i) => [group, CHART_COLORS[i % CHART_COLORS.length]]),
  );
}

/**
 * Plot insets, defined once because three things line up against them: the
 * chart's own grid, the legend's right anchor, and the total's left offset.
 * Percentages rather than px so the insets scale with the card, matching how
 * ExplorerChart frames its plots.
 */
// `top` is the gap between the count/legend row and the plot area — the space
// inside the bordered frame, not the card's own header gap above it.
const PLOT_GRID = { left: "8%", right: "5%", top: 70, bottom: "10%" };

const formatter = Intl.NumberFormat("en-US");

interface Props {
  rowsByDimension: FeatureUsageRowsByDimension | undefined;
  rowsMeta: FeatureUsageRowsMeta | undefined;
  /** The window's true COUNT(*) — the one total on this card. */
  total: number;
}

/**
 * The Diagnostics tab's chart, rendered through the same component the SQL
 * Explorer and dashboards use, so the three match by construction rather than
 * by mimicry.
 *
 * Rows are the API's per-dimension marginals, which is why the grouping control
 * costs nothing: switching it swaps one field name in the config and the chart
 * re-renders from rows already in hand.
 */
export default function FeatureEvaluationsCard({
  rowsByDimension,
  rowsMeta,
  total,
}: Props) {
  const [groupBy, setGroupBy] = useState<FeatureUsageDimension>("value");

  const rows = rowsByDimension?.[groupBy] ?? [];

  /**
   * `sum` is an identity here, not a re-aggregation: the API sends exactly one
   * row per (bucket x group), so every group the chart forms has a single
   * member and summing it returns that member. It is declared because yAxis
   * requires an aggregation, not because anything is being combined.
   */
  const dataVizConfig: Partial<DataVizConfig> = {
    chartType: "bar",
    xAxis: {
      fieldName: "timestamp",
      type: "date",
      sort: "asc",
      // "none" because the warehouse already bucketed these. Every other unit
      // re-rounds client-side; roundDate("none") is the only true no-op.
      dateAggregationUnit: "none",
    },
    yAxis: [{ fieldName: "evaluations", type: "number", aggregation: "sum" }],
    dimension: [
      {
        fieldName: "group",
        display: "stacked",
        maxValues: MAX_DIMENSION_VALUES,
      },
    ],
  };

  // Only when the warehouse genuinely withheld rows. Under the cap the API's
  // "(other)" preserves every evaluation, so this stays hidden.
  const charted = rowsMeta?.[groupBy]?.includedEvaluations ?? total;
  const notCharted = total > charted ? total - charted : 0;

  return (
    <Frame mb="4">
      <Flex align="center" justify="between" gap="3" wrap="wrap">
        <Heading as="h2" size="md" mb="0">
          Evaluations Over Time
        </Heading>

        <Flex align="center" gap="2">
          <Text size="sm" color="text-mid">
            Group by
          </Text>
          <SegmentedControl.Root
            size="1"
            className={styles.groupBy}
            value={groupBy}
            onValueChange={(v) => setGroupBy(v as FeatureUsageDimension)}
            role="radiogroup"
            aria-label="Group evaluations by"
          >
            {GROUP_BY_OPTIONS.map((option) => (
              <SegmentedControl.Item key={option.id} value={option.id}>
                {option.label}
              </SegmentedControl.Item>
            ))}
          </SegmentedControl.Root>
        </Flex>
      </Flex>

      {/* Under the header, not inside the plot frame: it summarises the card,
          so it sits with the card's own chrome rather than overlaying the
          chart's. "evaluations" stays on it — a bare number next to a plot
          reads as a data label rather than a summary. */}
      {/* Bordered plot container inside the card — the same treatment as
          ExplorerChart in Product Analytics. */}
      {/* 16px to the card header above. The stat line moved inside the frame,
          so nothing sits between the two any more and the gap has to be
          declared here rather than inherited from a subtitle's margin. */}
      <Box className={styles.plotFrame} mt="4">
        {/* On the legend's row, at its left. A DOM element rather than an
            ECharts title: the frame is already a div, so this needs no
            grid.top and leaves `title: []` matching the dashboards. */}
        <Flex
          align="baseline"
          gap="1"
          className={styles.plotTotal}
          // 48px from the plot frame's left edge, which is the card's content
          // edge — the frame has no horizontal padding of its own. The card
          // itself adds Frame's px="6" (32px) outside that, so this sits 80px
          // from the card's outer border.
          //
          // Deliberately no longer tracking PLOT_GRID.left: at 8% the count
          // started where the bars do, which read as too far in. It is now a
          // fixed offset, so it does not follow the plot as the card resizes.
          style={{ left: 48 }}
        >
          {/* Stat-tile typography without the tile: the number carries the
              weight, the noun stays body-sized and recedes. Two nodes so they
              can differ in size and colour; `align="baseline"` keeps them on
              one line rather than centred against each other.

              On the Text scale rather than a raw pixel size — it was 26px,
              roughly Radix step 6, and this is two steps down at step 4 (18px).
              Its line-height lands at 26px, the same box the 26px span
              occupied, so the vertical centring against the legend still
              holds. */}
          <Text size="xl" weight="medium" color="text-high">
            {formatter.format(total)}
          </Text>
          <Text size="md" color="text-mid">
            evaluations
          </Text>
        </Flex>
        <DataVisualizationDisplay
          rows={rows}
          dataVizConfig={dataVizConfig}
          seriesColors={buildSeriesColors(groupBy, rows)}
          legendPosition="top"
          // Right-anchored so the total has the left of the legend's row to
          // itself; centred, the two would meet in the middle.
          legendAlign="right"
          // The card's own title says what is plotted.
          showAxisNames={false}
          grid={PLOT_GRID}
          barMaxWidth={24}
        />
      </Box>

      {notCharted > 0 && (
        <Box mt="2">
          <Text size="sm" color="text-low">
            {`${formatter.format(notCharted)} evaluations not charted`}
          </Text>
        </Box>
      )}
    </Frame>
  );
}
