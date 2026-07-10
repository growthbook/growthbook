import { useMemo } from "react";
import {
  DashboardBlockInterfaceOrData,
  ExperimentsWinRateBlockInterface,
} from "shared/enterprise";
import { Box, Flex } from "@radix-ui/themes";
import EChartsReact from "echarts-for-react";
import { useAppearanceUITheme } from "@/services/AppearanceUIThemeProvider";
import { useDefinitions } from "@/services/DefinitionsContext";
import Text from "@/ui/Text";
import Table, {
  TableHeader,
  TableBody,
  TableRow,
  TableColumnHeader,
  TableCell,
} from "@/ui/Table";
import LoadingSpinner from "@/components/LoadingSpinner";
import {
  WinRateProjectRow,
  WinRateSummary,
  computeWinRateByProject,
  computeWinRateSummary,
  rangeLabel,
} from "./completedExperimentsData";
import { useCompletedExperimentsComparison } from "./completedExperiments";

const GOOD_PERCENT_LOW = 15;
const GOOD_PERCENT_HIGH = 38;
const DIAL_GRAY = "rgb(217,217,217)";
const DIAL_GREEN = "rgba(125,243,200,0.9)";
const GAUGE_HEIGHT = 200;

function gaugeOption(winRate: number, textColor: string) {
  return {
    series: [
      {
        type: "gauge",
        startAngle: 215,
        endAngle: -35,
        min: 0,
        max: 100,
        radius: "82%",
        center: ["50%", "58%"],
        progress: { show: false },
        axisLine: {
          lineStyle: {
            width: 14,
            color: [
              [GOOD_PERCENT_LOW / 100, DIAL_GRAY],
              [GOOD_PERCENT_HIGH / 100, DIAL_GREEN],
              [1, DIAL_GRAY],
            ],
          },
        },
        pointer: {
          width: 5,
          length: "62%",
          itemStyle: { color: "#4593f9" },
        },
        axisTick: { show: false },
        splitLine: { length: 10, lineStyle: { color: "auto", width: 1 } },
        axisLabel: { show: false },
        anchor: { show: true, size: 10, itemStyle: { color: "#4593f9" } },
        title: { show: false },
        detail: {
          valueAnimation: true,
          offsetCenter: [0, "36%"],
          formatter: (v: number) => `${v.toFixed(0)}%`,
          color: textColor,
          fontSize: 26,
          fontWeight: "bold" as const,
        },
        data: [{ value: winRate }],
      },
    ],
  };
}

function winLossOther(row: {
  wins: number;
  losses: number;
  other: number;
}): string {
  return `${row.wins}/${row.losses}/${row.other}`;
}

function winRatePct(row: { total: number; winRate: number }): string {
  return row.total > 0 ? `${row.winRate.toFixed(0)}%` : "-";
}

// Gauge + one-line summary, with an optional period label on top (compare mode).
function GaugePanel({
  summary,
  textColor,
  periodLabel,
  periodRange,
}: {
  summary: WinRateSummary;
  textColor: string;
  periodLabel?: string;
  periodRange?: string;
}) {
  return (
    <Flex direction="column" align="center" style={{ flex: 1, minWidth: 0 }}>
      {periodLabel && (
        <Box style={{ textAlign: "center" }}>
          <Text as="div" weight="medium">
            {periodLabel}
          </Text>
          <Text as="div" size="small" color="text-mid">
            {periodRange}
          </Text>
        </Box>
      )}
      <EChartsReact
        option={gaugeOption(summary.winRate, textColor)}
        style={{ width: "100%", height: GAUGE_HEIGHT }}
      />
      <Text as="div" size="small" align="center" color="text-mid">
        {summary.total} completed · {summary.wins} won, {summary.losses} lost,{" "}
        {summary.other} inconclusive
      </Text>
    </Flex>
  );
}

const RIGHT = { textAlign: "right" as const };
const GROUP_BORDER = { borderLeft: "1px solid var(--gray-a5)" };

export default function WinRateBlockChart({
  block,
}: {
  block: DashboardBlockInterfaceOrData<ExperimentsWinRateBlockInterface>;
}) {
  const { theme } = useAppearanceUITheme();
  const textColor = theme === "dark" ? "#FFFFFF" : "#1F2D5C";
  const { projects } = useDefinitions();

  const {
    current,
    previous,
    loading,
    window,
    previousWindow,
    comparisonEnabled,
  } = useCompletedExperimentsComparison(block);

  const currentSummary = useMemo(
    () => computeWinRateSummary(current),
    [current],
  );
  const previousSummary = useMemo(
    () => computeWinRateSummary(previous),
    [previous],
  );

  const tableRows = useMemo(() => {
    if (!block.showProjectBreakdown) return [];
    const currentRows = computeWinRateByProject(
      current,
      window.projects,
      projects,
    );
    const previousRows = comparisonEnabled
      ? computeWinRateByProject(previous, window.projects, projects)
      : [];
    const previousById = new Map<string, WinRateProjectRow>(
      previousRows.map((r) => [r.id, r]),
    );
    return currentRows.map((row) => ({
      row,
      previous: previousById.get(row.id) ?? null,
    }));
  }, [
    block.showProjectBreakdown,
    current,
    previous,
    window.projects,
    projects,
    comparisonEnabled,
  ]);

  if (loading) return <LoadingSpinner />;

  // Single (non-compare) breakdown table.
  const singleTable = (
    <Table>
      <TableHeader>
        <TableRow>
          <TableColumnHeader>Project</TableColumnHeader>
          <TableColumnHeader style={RIGHT}>Won/Lost/Other</TableColumnHeader>
          <TableColumnHeader style={RIGHT}>Win Rate</TableColumnHeader>
        </TableRow>
      </TableHeader>
      <TableBody>
        {tableRows.map(({ row }) => (
          <TableRow key={row.id}>
            <TableCell>{row.name}</TableCell>
            <TableCell style={RIGHT}>{winLossOther(row)}</TableCell>
            <TableCell style={RIGHT}>{winRatePct(row)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );

  // Compare breakdown table: each metric (Won/Lost/Other, Win Rate) splits into
  // Current | Previous sub-columns.
  const splitTable = (
    <Table>
      <TableHeader>
        <TableRow>
          <TableColumnHeader rowSpan={2}>Project</TableColumnHeader>
          <TableColumnHeader
            colSpan={2}
            style={{ textAlign: "center", ...GROUP_BORDER }}
          >
            Won/Lost/Other
          </TableColumnHeader>
          <TableColumnHeader
            colSpan={2}
            style={{ textAlign: "center", ...GROUP_BORDER }}
          >
            Win Rate
          </TableColumnHeader>
        </TableRow>
        <TableRow>
          <TableColumnHeader style={{ ...RIGHT, ...GROUP_BORDER }}>
            Current
          </TableColumnHeader>
          <TableColumnHeader style={RIGHT}>Previous</TableColumnHeader>
          <TableColumnHeader style={{ ...RIGHT, ...GROUP_BORDER }}>
            Current
          </TableColumnHeader>
          <TableColumnHeader style={RIGHT}>Previous</TableColumnHeader>
        </TableRow>
      </TableHeader>
      <TableBody>
        {tableRows.map(({ row, previous: prev }) => (
          <TableRow key={row.id}>
            <TableCell>{row.name}</TableCell>
            <TableCell style={{ ...RIGHT, ...GROUP_BORDER }}>
              {winLossOther(row)}
            </TableCell>
            <TableCell style={RIGHT}>
              {prev ? winLossOther(prev) : "-"}
            </TableCell>
            <TableCell style={{ ...RIGHT, ...GROUP_BORDER }}>
              {winRatePct(row)}
            </TableCell>
            <TableCell style={RIGHT}>{prev ? winRatePct(prev) : "-"}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );

  if (comparisonEnabled) {
    // Row 1: current + previous gauges side by side. Row 2: full-width split table.
    return (
      <Flex direction="column" gap="4" style={{ width: "100%" }}>
        <Flex gap="4" align="start" wrap="wrap">
          <GaugePanel
            summary={currentSummary}
            textColor={textColor}
            periodLabel="Current"
            periodRange={rangeLabel(window)}
          />
          <GaugePanel
            summary={previousSummary}
            textColor={textColor}
            periodLabel="Previous"
            periodRange={rangeLabel(previousWindow)}
          />
        </Flex>
        {block.showProjectBreakdown && <Box>{splitTable}</Box>}
      </Flex>
    );
  }

  // Compare off: gauge + table in one horizontal row.
  if (block.showProjectBreakdown) {
    return (
      <Flex gap="4" align="center" wrap="wrap" style={{ width: "100%" }}>
        <Box style={{ flex: "0 0 240px", maxWidth: "100%" }}>
          <GaugePanel summary={currentSummary} textColor={textColor} />
        </Box>
        <Box style={{ flex: "1 1 320px", minWidth: 0 }}>{singleTable}</Box>
      </Flex>
    );
  }

  return (
    <Flex justify="center" style={{ width: "100%" }}>
      <Box style={{ width: 300, maxWidth: "100%" }}>
        <GaugePanel summary={currentSummary} textColor={textColor} />
      </Box>
    </Flex>
  );
}
