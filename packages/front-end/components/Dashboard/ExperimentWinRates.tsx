import React, { useMemo } from "react";
import { Bar } from "@visx/shape";
import { Group } from "@visx/group";
import { scaleBand, scaleLinear } from "@visx/scale";
import { AxisLeft, AxisBottom } from "@visx/axis";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";

interface Props {
  experiments: ExperimentInterfaceStringDates[];
  height: number;
  width?: number;
}

// interface MonthlyStats {
//   month: string;
//   winRate: number;
//   total: number;
// }

export default function ExperimentWinRates({
  experiments,
  height,
  width = 400,
}: Props) {
  // Calculate monthly win rates
  const monthlyStats = useMemo(() => {
    const stats = new Map<string, { wins: number; total: number }>();

    experiments.forEach((exp) => {
      if (!exp.status || !exp.endDate) return;

      const date = new Date(exp.endDate);
      const monthKey = `${date.getFullYear()}-${String(
        date.getMonth() + 1
      ).padStart(2, "0")}`;

      if (!stats.has(monthKey)) {
        stats.set(monthKey, { wins: 0, total: 0 });
      }

      const monthStat = stats.get(monthKey)!;
      monthStat.total++;

      if (exp.status === "stopped") {
        monthStat.wins++;
      }
    });

    // Convert to array and calculate win rates
    return Array.from(stats.entries())
      .map(([month, { wins, total }]) => ({
        month,
        winRate: (wins / total) * 100,
        total,
      }))
      .sort((a, b) => a.month.localeCompare(b.month))
      .slice(-6); // Show last 6 months
  }, [experiments]);

  // Graph dimensions
  const margin = { top: 20, right: 20, bottom: 40, left: 40 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  // Scales
  const xScale = scaleBand<string>({
    range: [0, innerWidth],
    domain: monthlyStats.map((d) => d.month),
    padding: 0.2,
  });

  const yScale = scaleLinear<number>({
    range: [innerHeight, 0],
    domain: [0, 100],
  });

  return (
    <div>
      <h4>Experiment Win Rates</h4>
      <svg width={width} height={height}>
        <Group left={margin.left} top={margin.top}>
          {/* Y-axis */}
          <AxisLeft
            scale={yScale}
            tickFormat={(v) => `${v}%`}
            stroke="#888"
            tickStroke="#888"
            label="Win Rate"
          />

          {/* X-axis */}
          <AxisBottom
            top={innerHeight}
            scale={xScale}
            stroke="#888"
            tickStroke="#888"
            tickLabelProps={() => ({
              transform: "rotate(-45)",
              textAnchor: "end",
              fontSize: 10,
            })}
          />

          {/* Bars */}
          {monthlyStats.map((d) => {
            const barWidth = xScale.bandwidth();
            const barHeight = innerHeight - yScale(d.winRate);
            const barX = xScale(d.month) ?? 0;
            const barY = innerHeight - barHeight;

            return (
              <Bar
                key={d.month}
                x={barX}
                y={barY}
                width={barWidth}
                height={barHeight}
                fill="#3182ce"
                opacity={0.8}
              />
            );
          })}
        </Group>
      </svg>
    </div>
  );
}
