import { useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import {
  ScopeHealth,
  WIN_RATE_HEALTHY_RANGE,
  getHealthBand,
} from "shared/enterprise";
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
  score,
  previous,
}: {
  score: number | null;
  previous: number | null;
}) {
  if (score === null) {
    return (
      <Tooltip content="Fewer than 5 completed experiments">
        <Text color="text-low">–</Text>
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
      <Flex
        align="center"
        justify="center"
        style={{
          width: 34,
          height: 34,
          borderRadius: 6,
          fontWeight: 700,
          background: `var(--${color}-3)`,
          color: `var(--${color}-11)`,
        }}
      >
        {score}
      </Flex>
    </Tooltip>
  );
}

function WinRatePill({ value }: { value: number | null }) {
  if (value === null) return <Text color="text-low">–</Text>;
  const [low, high] = WIN_RATE_HEALTHY_RANGE;
  const inRange = value >= low && value <= high;
  return (
    <span
      style={{
        padding: "2px 6px",
        borderRadius: 3,
        fontSize: 12,
        fontWeight: 600,
        background: inRange ? "var(--green-a3)" : "var(--amber-a3)",
        color: inRange ? "var(--green-11)" : "var(--amber-11)",
      }}
    >
      {Math.round(value * 100)}%
    </span>
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
  return (
    <Box className="appbox" mb="5" p="4">
      <Heading as="h3" size="sm" mb="2">
        Health by Project
      </Heading>
      <Table variant="ghost">
        <TableHeader>
          <TableRow>
            <TableColumnHeader>Project</TableColumnHeader>
            <TableColumnHeader>Score</TableColumnHeader>
            {showTrend && <TableColumnHeader>Trend</TableColumnHeader>}
            <TableColumnHeader>Win rate</TableColumnHeader>
            <TableColumnHeader>Velocity</TableColumnHeader>
            <TableColumnHeader>Quality</TableColumnHeader>
            <TableColumnHeader>Biggest gap</TableColumnHeader>
          </TableRow>
        </TableHeader>
        <TableBody>
          {shown.map((r) => (
            <TableRow key={r.id}>
              <TableCell>
                {r.id ? (
                  <Link onClick={() => onSelectProject(r.id)}>{r.name}</Link>
                ) : (
                  r.name
                )}
              </TableCell>
              <TableCell>
                <ScoreTile score={r.health.score} previous={r.previousScore} />
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
    </Box>
  );
}
