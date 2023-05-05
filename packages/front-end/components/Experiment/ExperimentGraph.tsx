import React from "react";
import { BarRounded } from "@visx/shape";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { Group } from "@visx/group";
import { ParentSizeModern } from "@visx/responsive";
import { scaleBand, scaleLinear } from "@visx/scale";
import { GridRows } from "@visx/grid";
import format from "date-fns/format";
import { ExperimentStatus } from "back-end/types/experiment";
import { TooltipWithBounds, useTooltip } from "@visx/tooltip";
import { localPoint } from "@visx/event";
import { getValidDate } from "shared";
import { useDefinitions } from "@/services/DefinitionsContext";
import useApi from "@/hooks/useApi";
import LoadingOverlay from "../LoadingOverlay";
import styles from "./ExperimentGraph.module.scss";

export default function ExperimentGraph({
  resolution = "month",
  num = 12,
  status = "all",
  height = 250,
}: {
  resolution?: "month" | "day" | "year";
  num?: number;
  status: "all" | ExperimentStatus;
  height?: number;
}): React.ReactElement {
  const { project } = useDefinitions();

  const {
    showTooltip,
    hideTooltip,
    tooltipOpen,
    tooltipData,
    tooltipLeft = 0,
    tooltipTop = 0,
  } = useTooltip<number>();

  const { data, error } = useApi<{
    data: {
      all: { date: string; numExp: number }[];
      draft: { date: string; numExp: number }[];
      running: { date: string; numExp: number }[];
      stopped: { date: string; numExp: number }[];
    };
  }>(`/experiments/frequency/${resolution}/${num}?project=${project}`);

  if (error) {
    return (
      <div className="alert alert-danger">
        An error occurred: {error.message}
      </div>
    );
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  const graphData = data.data[status] ? data.data[status] : data.data.all;

  if (!graphData.length) {
    return <div>no data to show</div>;
  }

  return (
    <ParentSizeModern>
      {({ width }) => {
        const margin = [15, 30, 30, 30];
        const yMax = height - margin[0] - margin[2];
        const xMax = width - margin[1] - margin[3];
        const maxYValue = Math.ceil(
          Math.max(...graphData.map((d) => d.numExp), 1)
        );

        const barWidth = 35;
        const xScale = scaleBand({
          domain: graphData.map((d) => new Date(d.date)),
          range: [barWidth / 2, xMax],
          round: true,
          align: 0.5,
          padding: 1,
          paddingOuter: 0.15,
        });
        const yScale = scaleLinear<number>({
          domain: [0, maxYValue],
          range: [yMax, 0],
          round: true,
        });

        const handlePointer = (event: React.MouseEvent<SVGElement>) => {
          const coords = localPoint(event);
          // @ts-expect-error TS(2531) If you come across this, please fix it!: Object is possibly 'null'.
          const xCoord = coords.x - barWidth;

          const barData = graphData.map((d) => {
            return { xcord: xScale(getValidDate(d.date)), numExp: d.numExp };
          });

          const closestBar = barData.reduce((prev, curr) =>
            // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
            Math.abs(curr.xcord - xCoord) < Math.abs(prev.xcord - xCoord)
              ? curr
              : prev
          );
          let barHeight = yMax - (yScale(closestBar.numExp) ?? 0);
          if (barHeight === 0) barHeight = 6;
          const barY = yMax - barHeight;

          showTooltip({
            tooltipTop: barY - 25,
            tooltipLeft: closestBar.xcord,
            tooltipData: closestBar.numExp,
          });
        };

        return (
          <div
            onMouseLeave={() => {
              window.setTimeout(() => {
                hideTooltip();
              }, 100);
            }}
          >
            <div style={{ position: "relative" }}>
              {tooltipOpen && (
                <TooltipWithBounds
                  left={tooltipLeft}
                  top={tooltipTop}
                  className={styles.tooltip}
                  unstyled={true}
                >
                  {tooltipData} ex
                </TooltipWithBounds>
              )}
            </div>
            <svg width={width} height={height} onMouseMove={handlePointer}>
              <Group left={margin[3]} top={margin[0]}>
                <GridRows
                  scale={yScale}
                  numTicks={Math.min(maxYValue, 5)}
                  width={xMax + barWidth / 2}
                  stroke="var(--border-color-200)"
                />
                {graphData.map((d, i) => {
                  // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
                  const barX = xScale(getValidDate(d.date)) - barWidth / 2;
                  let barHeight = yMax - (yScale(d.numExp) ?? 0);
                  // if there are no experiments this month, show a little nub for design reasons.
                  if (barHeight === 0) barHeight = 6;
                  const barY = yMax - barHeight;
                  const name = format(getValidDate(d.date), "MMM yyy");
                  return (
                    <BarRounded
                      key={name + i}
                      x={barX + 5}
                      y={barY}
                      width={Math.max(10, barWidth - 10)}
                      height={barHeight}
                      fill={"#73D1F0"}
                      top
                      radius={6}
                      className={styles.barHov}
                    />
                  );
                })}

                <AxisBottom
                  top={yMax}
                  scale={xScale}
                  numTicks={
                    width > 670
                      ? graphData.length
                      : Math.ceil(graphData.length / 2)
                  }
                  tickLabelProps={() => ({
                    fill: "var(--text-color-table)",
                    fontSize: 11,
                    textAnchor: "start",
                    dx: -25,
                  })}
                  hideAxisLine={false}
                  stroke={"var(--text-color-table)"}
                  hideTicks={true}
                  rangePadding={barWidth / 2}
                  tickFormat={(v) => {
                    return format(v as Date, "LLL yyyy");
                  }}
                />
                <AxisLeft
                  scale={yScale}
                  numTicks={Math.min(maxYValue, 5)}
                  tickLabelProps={() => ({
                    fill: "var(--text-color-table)",
                    fontSize: 11,
                    textAnchor: "end",
                    dx: -2,
                    dy: 2,
                  })}
                  stroke={"var(--text-color-table)"}
                  hideTicks={true}
                  tickFormat={(v) => {
                    return Math.round(v as number) + "";
                  }}
                />
              </Group>
            </svg>
          </div>
        );
      }}
    </ParentSizeModern>
  );
}
