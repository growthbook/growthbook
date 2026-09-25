import { useEffect, useMemo, useRef, useState } from "react";
import { Box, Flex, SegmentedControl } from "@radix-ui/themes";
import clsx from "clsx";
import type {
  FeatureRule,
  FeatureUsageDimension,
  FeatureUsageRowsByDimension,
  FeatureUsageRowsMeta,
} from "shared/types/feature";
import type { ExperimentInterfaceStringDates } from "shared/types/experiment";
import type {
  MinimalFeatureRevisionInterface,
  DataVizConfig,
} from "shared/validators";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Frame from "@/ui/Frame";
import { DataVisualizationDisplay } from "@/components/DataViz/SqlExplorerDataVisualization";
import styles from "./FeatureEvaluationsCard.module.scss";
import {
  BreakdownRow,
  buildBreakdownRows,
  buildSeriesColors,
  DEFAULT_RULE_KEY,
  OTHER_GROUP,
} from "./featureEvaluationsBreakdown";

/**
 * Never tabs: all four render the same population with a different grouping,
 * so there is nothing to switch panels between. Radix's SegmentedControl is
 * built on ToggleGroup `type="single"`, which gives items `role="radio"` and
 * `aria-checked` — the semantics this actually has.
 */
const GROUP_BY_OPTIONS: { id: FeatureUsageDimension; label: string }[] = [
  { id: "value", label: "Value" },
  { id: "ruleId", label: "Rule" },
  { id: "source", label: "Source" },
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

const PANEL_HEADERS: Record<FeatureUsageDimension, string> = {
  value: "Values",
  ruleId: "Rules",
  source: "Sources",
  environment: "Environments",
};

function formatCount(n: number): string {
  return n >= 1_000_000 ? Y_AXIS_LABEL.format(n) : formatter.format(n);
}

function formatShare(count: number, total: number): string {
  if (total <= 0) return "";
  const share = (count / total) * 100;
  if (share > 0 && share < 0.1) return "<0.1%";
  return `${share.toFixed(1)}%`;
}

/**
 * Plot insets, defined once because three things line up against them: the
 * chart's own grid, the legend's right anchor, and the total's left offset.
 * Percentages rather than px so the insets scale with the card, matching how
 * ExplorerChart frames its plots.
 */
/**
 * A short, dense plot — the shape a Datadog-style chart uses when it is one
 * panel among several rather than the page's subject.
 *
 * 162px total. Only two things occupy vertical space: a 20px band above the
 * plot that belongs entirely to the revision labels, and the x-axis labels
 * below. The legend moved out of the canvas into the card header, where it
 * costs nothing — which is what freed the band.
 *
 * `left` and `right` are PIXELS, not percentages. A percentage inset scales
 * with the card, so on a wide screen 8% was reserving ~88px for a y-axis label
 * that needs about 30 ("150k" at 12px) — the plot was paying for width it never
 * used.
 *
 * Both are the measured minimum. 36px on the left clears "150k" with its tick
 * gap. 2px on the right is all that is left to give: nothing is drawn past the
 * plot on that side any more.
 *
 * It used to be 24, reserved purely as room for a revision label — "rev 3 ·
 * 25%" is ~70px wide and centred on its line, so one near the end of the window
 * ran off the edge. Those labels now flip to extend inward at the edges
 * (see markerAlign), so the inset no longer has to hold space for a label that
 * may not exist. Together these return ~105px of plot at 1100px over the
 * original 8%/5%.
 *
 * `bottom` stays a percentage deliberately: the mark-line overshoot resolves
 * its lower anchor from it, and that code requires a percentage.
 *
 * `bottom` at 16% is ~26px: the x-axis labels and their tick gap, nothing
 * else. It was 32.5% while the canvas also carried a legend beneath the
 * labels; the breakdown panel beside the chart names every series now, so the
 * legend is off and its band goes back to the plot.
 *
 * The labels are NOT rotated: nothing sets `axisLabel.rotate`, and a time axis
 * thins labels rather than turning them.
 */
const CHART_HEIGHT = "162px";
const PLOT_GRID = { left: 36, right: 2, top: 20, bottom: "16%" };

/**
 * Abbreviated y-axis ticks — 150k, not 150,000. A full-precision number is
 * wide enough to push the plot right, and on a chart whose y-axis exists to
 * give the bars a rough scale, the extra digits buy nothing.
 *
 * Lowercased because "150k" reads as a unit and "150K" reads as an initial.
 */
const Y_AXIS_LABEL = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const formatYAxisLabel = (value: number) =>
  Y_AXIS_LABEL.format(value).toLowerCase();

/**
 * Three. Note ECharts treats this as a hint and renders FOUR labels from it
 * (0 / 200 / 400 / 600 on a 600-max window) — splitNumber is not a count. Two
 * would give three labels if that is what you want.
 */
const Y_AXIS_SPLIT_NUMBER = 3;

/**
 * The line runs 14px up from the plot into the 20px band, and the label sits at
 * y is about 9 — inside the band, clear of the bars below and the canvas edge
 * above.
 *
 * A distance rather than a `position`: ECharts' `insideEnd*` positions render
 * nothing at all for a pixel-anchored mark line (verified), and the default
 * "end" puts the label at y = -4, clipped off the top of the canvas.
 */
const MARK_LINE_OVERSHOOT = 14;
const MARK_LINE_LABEL_DISTANCE = -8;

const formatter = Intl.NumberFormat("en-US");

/**
 * Labels go to the most recent few and the rest run as bare lines.
 *
 * Lines are never dropped: the line is the fact — traffic changed here, and
 * config changed here too — and it stays legible stacked a dozen deep because
 * it carries no text to collide. The label is what cannot survive crowding, so
 * that is what gets rationed. A week on an active flag can hold a dozen
 * publishes, and twelve overlapping "rev N"s are less readable than none.
 *
 * Most recent first because that is where a reader looking for "what changed?"
 * starts. Carried over from the visx markers this replaces, including the
 * count, so the restored behaviour is the old behaviour.
 */
const MAX_LABELLED_MARKERS = 3;

/**
 * How close to a plot edge a marker has to be before its label flips to extend
 * inward. A tenth of the window covers the label's half-width at every card
 * size this renders at — the label is a fixed ~70px, so it occupies a larger
 * share of a narrow plot than a wide one, and the threshold has to clear the
 * narrow case.
 */
const MARKER_EDGE_FRACTION = 0.1;

function markerAlign(
  t: number,
  min: number,
  max: number,
): "left" | "right" | undefined {
  const span = max - min;
  if (span <= 0) return undefined;
  const position = (t - min) / span;
  if (position > 1 - MARKER_EDGE_FRACTION) return "right";
  if (position < MARKER_EDGE_FRACTION) return "left";
  return undefined;
}

/**
 * Builds the dashed revision lines for the window.
 *
 * Published-only and in-window only: a draft has not affected traffic, and a
 * revision outside the window would be drawn at the plot edge as if it had just
 * happened. At Last 15 minutes that usually leaves none, which is correct —
 * these earn their keep at 24 hours and 7 days.
 */
function buildRevisionMarkers(
  revisions: MinimalFeatureRevisionInterface[] | undefined,
  rows: { timestamp: string }[],
  labelFor: (version: number) => string,
): { value: number; label?: string }[] {
  if (!revisions?.length || !rows.length) return [];

  // The window comes from the rows rather than from the lookback: the rows are
  // what the chart is actually plotting, so a marker placed against them cannot
  // drift from the bars the way a separately computed window could.
  const times = rows.map((r) => new Date(r.timestamp).getTime());
  const min = Math.min(...times);
  const max = Math.max(...times);

  return revisions
    .filter((r) => r.status === "published" && r.datePublished)
    .map((r) => ({
      version: r.version,
      t: new Date(r.datePublished as unknown as string).getTime(),
    }))
    .filter((r) => r.t >= min && r.t <= max)
    .sort((a, b) => b.t - a.t)
    .map((r, i) => ({
      value: r.t,
      label: i < MAX_LABELLED_MARKERS ? labelFor(r.version) : undefined,
      /**
       * A centred label is half its own width either side of the line, so one
       * near a plot edge runs off it. Markers in the outer tenth of the window
       * flip to extend inward instead.
       *
       * This is what lets the plot reach the card's padding: without it the
       * right inset had to reserve ~24px purely as room for a label that might
       * never be there.
       */
      align: markerAlign(r.t, min, max),
    }));
}

function BreakdownPanel({
  dimension,
  rows,
  total,
  selectedKey,
  onSelect,
  unavailableReason,
  width,
}: {
  dimension: FeatureUsageDimension;
  rows: BreakdownRow[];
  total: number;
  selectedKey: string | null;
  onSelect?: (picked: { key: string; label: string } | null) => void;
  /** Why no row can filter the stream right now; null when they can. */
  unavailableReason: string | null;
  /** Measured from the group-by control; the stylesheet's 326px until then. */
  width: number | null;
}) {
  const numbered = dimension === "ruleId";
  return (
    // A card of its own rather than a hairline beside the chart. Same height
    // as the chart, padding included, so the card's height still cannot vary.
    <Frame
      className={styles.panel}
      style={{
        height: CHART_HEIGHT,
        ...(width !== null ? { width, flexBasis: width } : {}),
      }}
      mb="0"
      py="3"
      px="3"
    >
      <div className={styles.panelHeader}>
        <Text size="sm" weight="semibold" color="text-high">
          {PANEL_HEADERS[dimension]}
        </Text>
      </div>
      {/* Only rules carry a number. Every other grouping drops the column
          outright rather than holding an empty one, so its content starts at
          the left edge. */}
      <div className={styles.panelList} role="list">
        {rows.map((row) => {
          const zero = row.count === 0;
          const unknown = row.count === null;
          const selected = selectedKey === row.key;
          // The default value is not a series you could expect a band for, so
          // it gets no "empty" outline — just the column, held for alignment.
          const isDefault = row.key === DEFAULT_RULE_KEY;
          // A row that cannot filter the stream is not clickable at all, and
          // says why on hover, rather than offering a click that would error.
          const blockedBy =
            unavailableReason ??
            (row.key === OTHER_GROUP
              ? "Other combines several groups, so it can't filter the stream"
              : null);
          return (
            <button
              key={row.key}
              type="button"
              role="listitem"
              aria-pressed={selected}
              aria-disabled={blockedBy !== null}
              className={clsx(styles.panelRow, {
                [styles.panelRowNoIndex]: !numbered,
                [styles.panelRowSelected]: selected,
                [styles.panelRowEmpty]: zero || unknown,
                [styles.panelRowBlocked]: blockedBy !== null,
              })}
              onClick={() => {
                if (blockedBy !== null) return;
                onSelect?.(
                  selected ? null : { key: row.key, label: row.label },
                );
              }}
              title={
                blockedBy ??
                (unknown
                  ? `${row.label} — outside the top 25 by volume, so its traffic, if any, is counted in Other`
                  : row.label)
              }
            >
              {numbered && (
                <span
                  className={clsx(styles.indexPill, {
                    [styles.indexPillBlank]: row.index === undefined,
                  })}
                >
                  {row.index ?? ""}
                </span>
              )}
              {/* No traffic, no band: a colour here would promise a stripe
                  in the chart that is not there. */}
              <span
                className={clsx(styles.swatch, {
                  [styles.swatchEmpty]: (zero || unknown) && !isDefault,
                })}
                style={zero || unknown ? undefined : { background: row.color }}
              />
              <span className={styles.rowLabel}>{row.label}</span>
              <span className={styles.rowCount}>
                {unknown ? "—" : formatCount(row.count ?? 0)}
              </span>
              <span className={styles.rowShare}>
                {row.count
                  ? formatShare(row.count, total)
                  : // Always a share for the default value, even at zero: it
                    // is the baseline every rule is read against.
                    isDefault && row.count === 0
                    ? "0%"
                    : ""}
              </span>
            </button>
          );
        })}
      </div>
    </Frame>
  );
}

interface Props {
  rowsByDimension: FeatureUsageRowsByDimension | undefined;
  rowsMeta: FeatureUsageRowsMeta | undefined;
  /** The window's true COUNT(*) — the one total on this card. */
  total: number;

  /**
   * The complete published history, for the dashed markers. Omitted draws none.
   *
   * Deliberately the minimal list rather than the full revisions: it is the only
   * complete one. The full revisions are capped at the five most recent, so a
   * week on an active flag would silently lose the older markers.
   */
  revisions?: MinimalFeatureRevisionInterface[];

  /**
   * Formats a marker's label. Passed in because what can be said about a
   * revision depends on data this card does not have — see the caller.
   */
  revisionLabel?: (version: number) => string;

  /**
   * Replaces the revision-derived markers outright, for a demo scenario that
   * plants its own transitions. Its labels say what the flag moved to rather
   * than which revision did it, because under a scenario no revision did.
   */
  markerOverride?: { value: number; label?: string }[];

  /**
   * The grouping, owned by the tab rather than by this card: a selection made
   * in one dimension is meaningless in another, so whoever holds the selection
   * has to hold the grouping too and clear one when the other changes.
   */
  groupBy: FeatureUsageDimension;
  setGroupBy: (dimension: FeatureUsageDimension) => void;

  /** The selected bucket, in chart terms. Null dims nothing. */
  selection?: { x: number; group?: string } | null;
  onSelect?: (selection: { x: number; group?: string }) => void;

  /** The flag's full rule list, in evaluation order. */
  rules: FeatureRule[];
  /** Added to a rule's list position to get the number on its card. */
  ruleNumberOffset: number;
  experimentsMap: Map<string, ExperimentInterfaceStringDates>;
  /** The environment scope chip's selection; rules outside it are omitted. */
  scopeEnvironments: string[];
  /** Environments relevant to the flag, listed even at zero. */
  environmentIds: string[];
  valueType?: string;

  /**
   * The breakdown-panel selection: one series across the whole window. Mutually
   * exclusive with `selection`, which the tab enforces.
   */
  seriesSelection?: string | null;
  onSeriesSelect?: (picked: { key: string; label: string } | null) => void;
  /**
   * Why the current grouping cannot filter the stream (its column is not in
   * this data source's rows), or null when it can. Rows are not clickable while
   * set.
   */
  seriesFilterUnavailable?: string | null;
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
  revisions,
  revisionLabel,
  markerOverride,
  groupBy,
  setGroupBy,
  selection,
  onSelect,
  rules,
  ruleNumberOffset,
  experimentsMap,
  scopeEnvironments,
  environmentIds,
  valueType,
  seriesSelection = null,
  onSeriesSelect,
  seriesFilterUnavailable = null,
}: Props) {
  const allRows = useMemo(
    () => rowsByDimension?.[groupBy] ?? [],
    [rowsByDimension, groupBy],
  );

  /**
   * Built from the UNFILTERED rows, so hiding one series does not recolour the
   * others — the palette is assigned by sorted position, and a shorter list
   * would shift every colour after the gap.
   */
  const seriesColors = useMemo(
    () => buildSeriesColors(groupBy, allRows, rules),
    [groupBy, allRows, rules],
  );

  const rows = allRows;

  // A scenario's transitions replace the real ones rather than joining them:
  // the synthetic data no longer follows the flag's publish history, so drawing
  // both would mark moments the bars do not reflect.
  const markLines =
    markerOverride ??
    buildRevisionMarkers(
      revisions,
      rows,
      revisionLabel ?? ((version) => `rev ${version}`),
    );

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

  /**
   * The panel is as wide as the group-by control above it. Both sit flush
   * against the card's right edge, so equal widths also line up their left
   * edges. Measured rather than hard-coded: the control's width is whatever its
   * four labels render at, and a constant would drift from it with the font.
   */
  const groupByRef = useRef<HTMLDivElement>(null);
  const [panelWidth, setPanelWidth] = useState<number | null>(null);
  useEffect(() => {
    const el = groupByRef.current;
    if (!el) return;
    const measure = () =>
      setPanelWidth(Math.round(el.getBoundingClientRect().width));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const breakdownRows = useMemo(
    () =>
      buildBreakdownRows({
        dimension: groupBy,
        rows: allRows,
        colors: seriesColors,
        complete:
          notCharted === 0 && !allRows.some((r) => r.group === OTHER_GROUP),
        rules,
        ruleNumberOffset,
        scopeEnvironments,
        environmentIds,
        experimentsMap,
        valueType,
      }),
    [
      groupBy,
      allRows,
      seriesColors,
      notCharted,
      rules,
      ruleNumberOffset,
      scopeEnvironments,
      environmentIds,
      experimentsMap,
      valueType,
    ],
  );

  // A bar selection and a series selection never coexist; the bar one wins if
  // both were somehow set. The series dim is deeper — it has to separate one
  // band from every other across the whole window, not one bar from its column.
  const chartSelection =
    selection ?? (seriesSelection !== null ? { group: seriesSelection } : null);

  return (
    <>
      {/* No card of its own and no title. This is the summary half of one card
          whose section header is "Feature Evaluations" directly above — a title
          here would name the only chart on the page twice, and a Frame here
          would redraw the boundary the merge removed.

          Two things only: what the colours mean (left) and how to re-cut the
          data (right). The count moved up to the page header, where it sits
          with the title it qualifies. */}
      <Flex align="center" gap="3" wrap="wrap">
        {/* Sibling to "Evaluation Stream" below the divider — the same h3 at
            the same size, so the two halves of the card read as two sections of
            equal standing rather than one nested in the other. Copied from that
            header rather than approximated. */}
        <Heading as="h3" size="sm" mb="0">
          Evaluations Over Time
        </Heading>

        {/* Spacer: pushes the grouping control to the right edge, so the two
            halves of the row are "what this is" and "how to re-cut it". */}
        <Flex align="center" gap="2" style={{ marginLeft: "auto" }}>
          <SegmentedControl.Root
            ref={groupByRef}
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
      {/* The count for the query, under the header rather than beside it: it
          describes what the chart below is drawn from, and on the header row it
          competed with the title for the same slot.

          Same treatment as "60 rows" in the Evaluation Stream section — Text
          size sm, text-low — so the two sections' secondary lines match.

          No margin above, 12px below. It sits directly under the header and
          clear of the plot, so it reads as a caption on the chart rather than
          as a line floating between the two. The header row is 24px tall
          against 22px of type, so there is still a hair of space from that. */}
      {/* The not-charted disclosure rides on this line rather than its own:
          it varies by group-by, and a line that comes and goes would change
          the card's height and move the stream below. */}
      <Text size="sm" color="text-low" as="div">
        {`${formatter.format(total)} evaluations`}
        {notCharted > 0 && ` · ${formatter.format(notCharted)} not charted`}
      </Text>

      {/* 12px is space-3, so this is back on the scale and needs no inline
          value. */}
      <Flex mt="3" className={styles.chartRow}>
        <Box className={styles.plotFrame}>
          <DataVisualizationDisplay
            rows={rows}
            dataVizConfig={dataVizConfig}
            seriesColors={seriesColors}
            // Right-anchored so the total has the left of the legend's row to
            // itself; centred, the two would meet in the middle.
            // The card's own title says what is plotted.
            showAxisNames={false}
            // The breakdown panel is the legend: it lists every series,
            // including ones with no band, so a second one would repeat it.
            showLegend={false}
            grid={PLOT_GRID}
            barMaxWidth={24}
            chartHeight={{ minHeight: CHART_HEIGHT, height: CHART_HEIGHT }}
            yAxisSplitNumber={Y_AXIS_SPLIT_NUMBER}
            yAxisLabelFormatter={formatYAxisLabel}
            markLineLabelDistance={MARK_LINE_LABEL_DISTANCE}
            markLineOvershoot={MARK_LINE_OVERSHOOT}
            markLines={markLines}
            selection={chartSelection}
            selectionDimOpacity={selection ? 0.25 : 0.16}
            onSelect={onSelect}
          />
        </Box>
        <BreakdownPanel
          width={panelWidth}
          dimension={groupBy}
          rows={breakdownRows}
          total={total}
          selectedKey={selection ? null : seriesSelection}
          onSelect={onSeriesSelect}
          unavailableReason={seriesFilterUnavailable}
        />
      </Flex>
    </>
  );
}
