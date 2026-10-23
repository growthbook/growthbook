import { ReactNode, useMemo } from "react";
import { Box, Flex } from "@radix-ui/themes";
import EChartsReact from "echarts-for-react";
import { format as formatDate } from "date-fns";
import { useAppearanceUITheme } from "@/services/AppearanceUIThemeProvider";
import {
  cssColorToHex,
  getChartThemeColors,
} from "@/enterprise/components/ProductAnalytics/chart-theme";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";
import { CounterfactualPoint, ExperimentImpactRow } from "./impactData";

// Matches the grid padding so the React lanes line up with the plot
const PLOT_LEFT = 64;
const PLOT_RIGHT = 16;
const MAX_LANES = 10;

export type ImpactLane = {
  id: string;
  name: string;
  start: Date;
  end: Date | null;
  kind: "shipped" | "rolledBack" | "running";
  row: ExperimentImpactRow | null;
};

function withAlpha(hex: string, alpha: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function Stat({
  value,
  label,
  color,
}: {
  value: ReactNode;
  label: string;
  color?: string;
}) {
  return (
    <Box>
      <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
      <Text size="sm" color="text-low">
        {label}
      </Text>
    </Box>
  );
}

function LegendItem({ swatch, label }: { swatch: ReactNode; label: string }) {
  return (
    <Flex align="center" gap="1">
      {swatch}
      <Text size="sm" color="text-mid">
        {label}
      </Text>
    </Flex>
  );
}

function monthTicks(start: Date, end: Date): Date[] {
  const ticks: Date[] = [];
  const cursor = new Date(start.getFullYear(), start.getMonth() + 1, 1);
  while (cursor <= end) {
    ticks.push(new Date(cursor));
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return ticks;
}

export default function ImpactChart({
  title,
  points,
  lift,
  liftCI,
  meanTotal,
  lanes,
  window,
  debias,
  formatValue,
  formatAnnual,
}: {
  title: string;
  points: CounterfactualPoint[];
  lift: number;
  liftCI: number;
  meanTotal: number;
  lanes: ImpactLane[];
  window: { startDate: Date; endDate: Date };
  debias: boolean;
  formatValue: (v: number) => string;
  formatAnnual: (v: number) => string;
}) {
  const { theme } = useAppearanceUITheme();
  const { textColor, gridLineColor, tooltipBackgroundColor } =
    getChartThemeColors(theme);
  const colors = useMemo(
    () => ({
      violet: cssColorToHex("var(--violet-9)"),
      gray: cssColorToHex("var(--gray-9)"),
      red: cssColorToHex("var(--red-9)"),
      band: theme === "dark" ? "rgba(255,255,255,0.08)" : "rgba(0,0,51,0.06)",
    }),
    [theme],
  );

  const shownLanes = useMemo(
    () =>
      [...lanes]
        .sort(
          (a, b) =>
            Math.abs(b.row?.annualValue ?? 0) -
            Math.abs(a.row?.annualValue ?? 0),
        )
        .slice(0, MAX_LANES)
        .sort((a, b) => a.start.getTime() - b.start.getTime()),
    [lanes],
  );

  const option = useMemo(() => {
    const xs = points.map((p) => p.date.getTime());
    const shipDates = shownLanes.flatMap((l) =>
      l.kind === "shipped" && l.end ? [l.end.getTime()] : [],
    );
    const hidden = {
      type: "line" as const,
      symbol: "none",
      lineStyle: { opacity: 0 },
      silent: true,
    };
    return {
      animation: false,
      grid: { left: PLOT_LEFT, right: PLOT_RIGHT, top: 12, bottom: 8 },
      tooltip: {
        trigger: "axis",
        appendTo: "body",
        backgroundColor: tooltipBackgroundColor,
        textStyle: { color: textColor },
        formatter: (params: { dataIndex: number }[]) => {
          const p = points[params?.[0]?.dataIndex ?? 0];
          if (!p) return "";
          return [
            `<strong>${formatDate(p.date, "MMM d, yyyy")}</strong>`,
            `Actual: ${formatValue(p.actual)}`,
            `Without experiments: ${formatValue(p.without)}`,
          ].join("<br/>");
        },
      },
      xAxis: {
        type: "time",
        min: window.startDate.getTime(),
        max: window.endDate.getTime(),
        axisLabel: { show: false },
        axisTick: { show: false },
        axisLine: { lineStyle: { color: gridLineColor } },
      },
      yAxis: {
        type: "value",
        scale: true,
        axisLabel: {
          color: textColor,
          formatter: (v: number) => formatValue(v),
        },
        splitLine: { lineStyle: { color: gridLineColor } },
      },
      series: [
        {
          ...hidden,
          name: "lower",
          stack: "interval",
          data: points.map((p, i) => [xs[i], p.lower]),
        },
        {
          ...hidden,
          name: "interval",
          stack: "interval",
          areaStyle: { color: colors.band },
          data: points.map((p, i) => [xs[i], p.upper - p.lower]),
        },
        {
          ...hidden,
          name: "base",
          stack: "gain",
          data: points.map((p, i) => [xs[i], p.without]),
        },
        {
          ...hidden,
          name: "gain",
          stack: "gain",
          areaStyle: { color: withAlpha(colors.violet, 0.16) },
          data: points.map((p, i) => [xs[i], p.actual - p.without]),
        },
        {
          name: "Without experiments",
          type: "line",
          symbol: "none",
          lineStyle: { color: colors.gray, width: 1.5, type: "dashed" },
          data: points.map((p, i) => [xs[i], p.without]),
        },
        {
          name: "Actual",
          type: "line",
          symbol: "none",
          lineStyle: { color: textColor, width: 2 },
          data: points.map((p, i) => [xs[i], p.actual]),
          markLine: {
            silent: true,
            symbol: "none",
            label: { show: false },
            lineStyle: { color: colors.violet, type: "dashed", opacity: 0.35 },
            data: shipDates.map((x) => ({ xAxis: x })),
          },
        },
      ],
    };
  }, [
    points,
    shownLanes,
    window,
    colors,
    textColor,
    gridLineColor,
    tooltipBackgroundColor,
    formatValue,
  ]);

  const span = window.endDate.getTime() - window.startDate.getTime();
  const pct = (d: Date) =>
    Math.min(
      Math.max((d.getTime() - window.startDate.getTime()) / span, 0),
      1,
    ) * 100;
  const last = points[points.length - 1];

  return (
    <Box className="appbox" mb="4" p="4">
      <Heading as="h3" size="sm" mb="3">
        {title} — Actual vs. Without Experiments
      </Heading>
      <Flex gap="6" mb="3" wrap="wrap">
        <Stat value={formatValue(last.actual)} label="Actual today" />
        <Stat
          value={formatValue(last.without)}
          label="Without experiments (est.)"
          color="var(--gray-11)"
        />
        <Stat
          value={`${lift >= 0 ? "+" : ""}${(lift * 100).toFixed(1)}%`}
          label={`From experiments · ±${(liftCI * 100).toFixed(1)}%`}
          color="var(--violet-11)"
        />
      </Flex>
      <EChartsReact option={option} notMerge style={{ height: 260 }} />
      <Box
        mt="2"
        style={{ marginLeft: PLOT_LEFT, marginRight: PLOT_RIGHT }}
        aria-label="Experiment runs"
      >
        {shownLanes.map((lane) => {
          const left = pct(lane.start);
          const right = pct(lane.end ?? window.endDate);
          const color = lane.kind === "rolledBack" ? colors.red : colors.violet;
          const row = lane.row;
          return (
            <Tooltip
              key={lane.id}
              content={
                <Box>
                  <div>
                    <strong>{lane.name}</strong>
                  </div>
                  {lane.kind === "running" ? (
                    <div>Running since {formatDate(lane.start, "MMM d")}</div>
                  ) : (
                    <div>
                      {lane.kind === "shipped" ? "Shipped" : "Rolled back"}{" "}
                      {lane.end ? formatDate(lane.end, "MMM d, yyyy") : ""}
                    </div>
                  )}
                  {row?.relativeLift !== null &&
                    row?.relativeLift !== undefined && (
                      <div>Lift: {(row.relativeLift * 100).toFixed(1)}%</div>
                    )}
                  {row?.dailyImpact !== null &&
                    row?.dailyImpact !== undefined &&
                    meanTotal > 0 && (
                      <div>
                        Contribution to the overall metric:{" "}
                        {((row.dailyImpact / meanTotal) * 100).toFixed(2)}%
                      </div>
                    )}
                  {row?.annualValue !== null &&
                    row?.annualValue !== undefined && (
                      <div>
                        {formatAnnual(row.annualValue)}/yr
                        {lane.kind === "rolledBack" ? " avoided" : ""}
                      </div>
                    )}
                </Box>
              }
            >
              <Box style={{ position: "relative", height: 18 }}>
                <div
                  style={{
                    position: "absolute",
                    left: `${left}%`,
                    width: `${Math.max(right - left, 0.5)}%`,
                    top: 6,
                    height: 6,
                    borderRadius: 3,
                    background:
                      lane.kind === "running"
                        ? withAlpha(colors.violet, 0.2)
                        : withAlpha(color, 0.35),
                  }}
                />
                {lane.start < window.startDate && (
                  <span
                    style={{
                      position: "absolute",
                      left: -14,
                      top: 0,
                      fontSize: 11,
                      color: "var(--gray-10)",
                    }}
                  >
                    ←
                  </span>
                )}
                {lane.kind !== "running" && (
                  <span
                    style={{
                      position: "absolute",
                      left: `calc(${right}% - 4px)`,
                      top: 5,
                      width: 8,
                      height: 8,
                      background: color,
                      borderRadius: lane.kind === "shipped" ? "50%" : 1,
                      transform:
                        lane.kind === "rolledBack"
                          ? "rotate(45deg)"
                          : undefined,
                    }}
                  />
                )}
                <span
                  style={{
                    position: "absolute",
                    ...(right > 70
                      ? { right: `calc(${100 - left}% + 6px)` }
                      : { left: `calc(${right}% + 8px)` }),
                    top: 1,
                    fontSize: 11,
                    whiteSpace: "nowrap",
                    color: "var(--gray-11)",
                  }}
                >
                  {lane.name}
                </span>
              </Box>
            </Tooltip>
          );
        })}
        <Box style={{ position: "relative", height: 20 }} mt="1">
          {monthTicks(window.startDate, window.endDate).map((d) => (
            <span
              key={d.getTime()}
              style={{
                position: "absolute",
                left: `${pct(d)}%`,
                transform: "translateX(-50%)",
                fontSize: 11,
                color: "var(--gray-10)",
              }}
            >
              {formatDate(d, "MMM d")}
            </span>
          ))}
        </Box>
      </Box>
      {lanes.length > shownLanes.length && (
        <Text as="div" size="sm" color="text-low">
          Showing the {shownLanes.length} largest of {lanes.length} experiments
        </Text>
      )}
      <Flex gap="4" wrap="wrap" mt="3">
        <LegendItem
          swatch={
            <span style={{ width: 14, height: 2, background: textColor }} />
          }
          label="Actual"
        />
        <LegendItem
          swatch={
            <span
              style={{ width: 14, borderTop: `1.5px dashed ${colors.gray}` }}
            />
          }
          label="Without experiments"
        />
        <LegendItem
          swatch={
            <span
              style={{
                width: 10,
                height: 10,
                background: withAlpha(colors.violet, 0.3),
              }}
            />
          }
          label="Gain from experiments"
        />
        <LegendItem
          swatch={
            <span
              style={{
                width: 14,
                height: 6,
                borderRadius: 3,
                background: withAlpha(colors.violet, 0.2),
              }}
            />
          }
          label="Running"
        />
        <LegendItem
          swatch={
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: colors.violet,
              }}
            />
          }
          label="Shipped"
        />
        <LegendItem
          swatch={
            <span
              style={{
                width: 8,
                height: 8,
                background: colors.red,
                transform: "rotate(45deg)",
              }}
            />
          }
          label="Rolled back"
        />
      </Flex>
      <Text as="p" size="sm" color="text-low" mt="3" mb="0">
        Each shipped experiment&apos;s effect ramps in from its start date to
        its ship date, then holds, which assumes the lift persists. Effects use
        the {debias ? "de-biased" : "raw measured"} scaled impact, as a share of
        the metric&apos;s average daily total. The shaded band is the 95%
        interval. Rolled-back experiments count as avoided loss and don&apos;t
        change the estimate.
      </Text>
    </Box>
  );
}
