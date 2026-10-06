import { useMemo } from "react";
import { date } from "shared/dates";
import { ParentSizeModern } from "@visx/responsive";
import { Group } from "@visx/group";
import { GridRows } from "@visx/grid";
import { scaleLinear, scaleTime } from "@visx/scale";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { AreaClosed, LinePath } from "@visx/shape";
import { curveMonotoneX } from "@visx/curve";
import { localPoint } from "@visx/event";
import { TooltipWithBounds, useTooltip } from "@visx/tooltip";

export type PopulationSizePoint = { date: Date; value: number };

const HEIGHT = 240;
const MARGIN = { top: 12, right: 16, bottom: 32, left: 56 };
const compact = new Intl.NumberFormat(undefined, { notation: "compact" });

export default function PopulationSizeGraph({
  points,
  valueLabel,
}: {
  points: PopulationSizePoint[];
  valueLabel: string;
}) {
  const { tooltipData, tooltipLeft, tooltipTop, showTooltip, hideTooltip } =
    useTooltip<PopulationSizePoint>();
  const maxValue = useMemo(
    () => Math.max(1, ...points.map((p) => p.value)),
    [points],
  );

  return (
    <ParentSizeModern style={{ position: "relative" }}>
      {({ width }) => {
        const xMax = Math.max(0, width - MARGIN.left - MARGIN.right);
        const yMax = HEIGHT - MARGIN.top - MARGIN.bottom;
        const times = points.map((p) => p.date.getTime());
        // A single point needs some width to sit in.
        const xDomain =
          times.length > 1
            ? [Math.min(...times), Math.max(...times)]
            : [times[0] - 86400000, times[0] + 86400000];
        const xScale = scaleTime({ domain: xDomain, range: [0, xMax] });
        const yScale = scaleLinear({
          domain: [0, maxValue * 1.1],
          range: [yMax, 0],
          nice: true,
        });

        return (
          <>
            <svg
              width={width}
              height={HEIGHT}
              onMouseLeave={hideTooltip}
              onMouseMove={(e) => {
                const point = localPoint(e);
                if (!point || !points.length) return;
                const x = point.x - MARGIN.left;
                const nearest = points.reduce((a, b) =>
                  Math.abs(xScale(a.date) - x) <= Math.abs(xScale(b.date) - x)
                    ? a
                    : b,
                );
                showTooltip({
                  tooltipData: nearest,
                  tooltipLeft: xScale(nearest.date) + MARGIN.left,
                  tooltipTop: yScale(nearest.value) + MARGIN.top,
                });
              }}
            >
              <Group left={MARGIN.left} top={MARGIN.top}>
                <GridRows
                  scale={yScale}
                  width={xMax}
                  numTicks={4}
                  stroke="var(--slate-a4)"
                />
                <AreaClosed
                  data={points}
                  x={(p) => xScale(p.date)}
                  y={(p) => yScale(p.value)}
                  yScale={yScale}
                  curve={curveMonotoneX}
                  fill="var(--violet-a4)"
                />
                <LinePath
                  data={points}
                  x={(p) => xScale(p.date)}
                  y={(p) => yScale(p.value)}
                  curve={curveMonotoneX}
                  stroke="var(--violet-9)"
                  strokeWidth={2}
                />
                {points.map((p) => (
                  <circle
                    key={p.date.getTime()}
                    cx={xScale(p.date)}
                    cy={yScale(p.value)}
                    r={tooltipData === p ? 5 : 3}
                    fill="var(--violet-9)"
                  />
                ))}
                <AxisLeft
                  scale={yScale}
                  numTicks={4}
                  tickFormat={(v) => compact.format(Number(v))}
                  stroke="var(--slate-a7)"
                  tickStroke="var(--slate-a7)"
                  tickLabelProps={() => ({
                    fill: "var(--color-text-mid)",
                    fontSize: 11,
                    textAnchor: "end",
                    dx: -4,
                    dy: 4,
                  })}
                />
                <AxisBottom
                  top={yMax}
                  scale={xScale}
                  // Few points span days at most, so automatic ticks would
                  // repeat the same date; label each point instead.
                  tickValues={
                    points.length <= 6 ? points.map((p) => p.date) : undefined
                  }
                  numTicks={Math.min(6, Math.max(2, Math.floor(xMax / 110)))}
                  tickFormat={(v) => date(v as Date)}
                  stroke="var(--slate-a7)"
                  tickStroke="var(--slate-a7)"
                  tickLabelProps={() => ({
                    fill: "var(--color-text-mid)",
                    fontSize: 11,
                    textAnchor: "middle",
                  })}
                />
              </Group>
            </svg>
            {tooltipData && (
              <TooltipWithBounds left={tooltipLeft} top={tooltipTop}>
                <div style={{ fontWeight: 500 }}>
                  {tooltipData.value.toLocaleString()} {valueLabel}
                </div>
                <div style={{ color: "var(--color-text-mid)" }}>
                  {date(tooltipData.date)}
                </div>
              </TooltipWithBounds>
            )}
          </>
        );
      }}
    </ParentSizeModern>
  );
}
