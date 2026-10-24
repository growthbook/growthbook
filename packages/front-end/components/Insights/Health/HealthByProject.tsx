import { useState } from "react";
import { Box } from "@radix-ui/themes";
import {
  ScopeHealth,
  WIN_RATE_HEALTHY_RANGE,
  getHealthBand,
  getNoScoreReason,
} from "shared/enterprise";
import { useSearch } from "@/services/search";
import Frame from "@/ui/Frame";
import Badge from "@/ui/Badge";
import Heading from "@/ui/Heading";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";
import { BAND_COLORS } from "./HealthHeadline";

const NO_PROJECT_KEY = "__no_project__";

// Flat fields to sort on; undefined sorts last
type SortItem = {
  id: string;
  name: string;
  score?: number;
  winRate?: number;
  velocity: number;
  quality?: number;
  gap: string;
  row: ProjectHealthRow;
};
// About ten rows, then the table scrolls under its header
const MAX_TABLE_HEIGHT = 480;

export type ProjectHealthRow = {
  id: string;
  // Started or completed an experiment in the period
  active: boolean;
  name: string;
  health: ScopeHealth;
  previousScore: number | null;
  trend: number[] | null;
  biggestGap: string;
};

function Sparkline({ values }: { values: number[] }) {
  const w = 110;
  const h = 28;
  const y = (v: number) => h - (Math.min(Math.max(v, 0), 100) / 100) * h;
  const x = (i: number) => (i / Math.max(values.length - 1, 1)) * w;
  const delta = values[values.length - 1] - values[0];
  const color =
    delta > 0
      ? "var(--green-9)"
      : delta < 0
        ? "var(--red-9)"
        : "var(--violet-9)";
  return (
    <svg width={w} height={h} aria-hidden>
      <line
        x1={0}
        x2={w}
        y1={y(75)}
        y2={y(75)}
        stroke="var(--gray-a6)"
        strokeDasharray="3 3"
      />
      <polyline
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        points={values.map((v, i) => `${x(i)},${y(v)}`).join(" ")}
      />
    </svg>
  );
}

function ScoreTile({
  health,
  previous,
}: {
  health: ScopeHealth;
  previous: number | null;
}) {
  const { score } = health;
  if (score === null) {
    return (
      <Tooltip content={getNoScoreReason(health) ?? ""}>
        <span tabIndex={0}>
          <Text color="text-low">–</Text>
        </span>
      </Tooltip>
    );
  }
  const color = BAND_COLORS[getHealthBand(score)];
  const change =
    previous === null
      ? ""
      : ` · ${score >= previous ? "▲" : "▼"} ${Math.abs(score - previous)} vs previous period`;
  return (
    <Tooltip content={`${score} / 100${change}`}>
      {/* Focusable, so keyboard users can open the score details too */}
      <span tabIndex={0}>
        <Badge label={String(score)} color={color} variant="soft" size="md" />
      </span>
    </Tooltip>
  );
}

function WinRatePill({ value }: { value: number | null }) {
  if (value === null) return <Text color="text-low">–</Text>;
  const [low, high] = WIN_RATE_HEALTHY_RANGE;
  return (
    <Badge
      label={`${Math.round(value * 100)}%`}
      color={value >= low && value <= high ? "green" : "amber"}
      variant="soft"
    />
  );
}

export default function HealthByProject({
  rows,
  onSelectProject,
}: {
  rows: ProjectHealthRow[];
  onSelectProject: (id: string) => void;
}) {
  const [showInactive, setShowInactive] = useState(false);
  const activeCount = rows.filter((r) => r.active).length;
  const inactiveCount = rows.length - activeCount;
  // Inactive Projects are collapsed so busy orgs stay readable
  const shown = rows.filter((r) => r.active || showInactive);
  const showTrend = shown.some((r) => r.trend !== null);
  const items = shown.map(
    (r): SortItem => ({
      id: r.id || NO_PROJECT_KEY,
      name: r.name,
      score: r.health.score ?? undefined,
      winRate: r.health.winRate ?? undefined,
      velocity: r.health.startRate,
      quality: r.health.quality ?? undefined,
      gap: r.biggestGap,
      row: r,
    }),
  );
  const { items: sorted, SortableTableColumnHeader } = useSearch({
    items,
    searchFields: ["name"],
    localStorageKey: "insights-health-projects",
    defaultSortField: "score",
    defaultSortDir: -1,
    undefinedLast: true,
    // Sort only; there's no search box here
    controlledSearchValue: "",
  });
  const header = (field: keyof SortItem, label: string) => (
    <SortableTableColumnHeader field={field} style={{ whiteSpace: "nowrap" }}>
      {label}
    </SortableTableColumnHeader>
  );
  return (
    <Frame mb="5" py="4" px="4">
      <Heading as="h3" size="sm" mb="2">
        Health by Project
      </Heading>
      <Table
        variant="ghost"
        scrollX
        stickyHeader
        stickyTopOffset={0}
        maxHeight={MAX_TABLE_HEIGHT}
      >
        <TableHeader>
          <TableRow>
            {header("name", "Project")}
            {header("score", "Score")}
            {showTrend && <TableColumnHeader>Trend</TableColumnHeader>}
            {header("winRate", "Win rate")}
            {header("velocity", "Velocity")}
            {header("quality", "Quality")}
            {header("gap", "Biggest gap")}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map(({ row: r }) => (
            <TableRow key={r.id}>
              <TableCell>
                {r.id ? (
                  <Link onClick={() => onSelectProject(r.id)}>{r.name}</Link>
                ) : (
                  r.name
                )}
              </TableCell>
              <TableCell>
                <ScoreTile health={r.health} previous={r.previousScore} />
              </TableCell>
              {showTrend && (
                <TableCell>
                  {r.trend ? (
                    <Sparkline values={r.trend} />
                  ) : (
                    <Text color="text-low">–</Text>
                  )}
                </TableCell>
              )}
              <TableCell>
                <WinRatePill value={r.health.winRate} />
              </TableCell>
              <TableCell>
                <Text weight="medium">
                  {r.health.startRate.toFixed(1)} / mo
                </Text>
              </TableCell>
              <TableCell>
                <Text weight="medium">
                  {r.health.quality === null
                    ? "–"
                    : Math.round(r.health.quality)}
                </Text>
              </TableCell>
              <TableCell>
                <Text size="sm" color="text-mid">
                  {r.biggestGap}
                </Text>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {activeCount === 0 && !showInactive && (
        <Text as="div" color="text-mid" mt="2">
          No Project started or finished an experiment in this period.
        </Text>
      )}
      {inactiveCount > 0 && (
        <Box mt="2">
          <Link onClick={() => setShowInactive(!showInactive)} size="sm">
            {showInactive
              ? "Hide Projects with no activity"
              : `Show ${inactiveCount} Project${inactiveCount === 1 ? "" : "s"} with no activity in this period`}
          </Link>
        </Box>
      )}
    </Frame>
  );
}
