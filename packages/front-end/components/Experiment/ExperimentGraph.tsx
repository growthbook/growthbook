import React from "react";
import useApi from "../../hooks/useApi";
import LoadingOverlay from "../LoadingOverlay";
import { BarRounded } from "@visx/shape";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { Group } from "@visx/group";
import { ParentSizeModern } from "@visx/responsive";
import { scaleLinear, scaleTime } from "@visx/scale";
import { GridRows } from "@visx/grid";
import format from "date-fns/format";
import { useDefinitions } from "../../services/DefinitionsContext";
import { getValidDate } from "../../services/dates";

export default function ExperimentGraph({
  resolution = "month",
  num = 12,
  status = "all",
  height = 250,
}: {
  resolution?: "month" | "day" | "year";
  num?: number;
  status: "all" | "draft" | "running" | "stopped";
  height?: number;
}): React.ReactElement {
  const { project } = useDefinitions();

  const { data, error } = useApi<{
    data: {
      all: { name: string; numExp: number }[];
      draft: { name: string; numExp: number }[];
      running: { name: string; numExp: number }[];
      stopped: { name: string; numExp: number }[];
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

  const firstMonth = getValidDate(graphData[0].name);
  const lastMonth = getValidDate(graphData[graphData.length - 1].name);

  return (
    <ParentSizeModern>
      {({ width }) => {
        const margin = [15, 30, 30, 30];
        const yMax = height - margin[0] - margin[2];
        const xMax = width - margin[1] - margin[3];
        const maxYValue = Math.ceil(
          Math.max(...graphData.map((d) => d.numExp), 1)
        );

        const barWidth = 25;
        const xScale = scaleTime({
          domain: [firstMonth, lastMonth],
          range: [barWidth / 2, xMax],
          round: true,
          nice: true,
          clamp: false,
        });
        const yScale = scaleLinear<number>({
          domain: [0, maxYValue],
          range: [yMax, 0],
          round: true,
        });

        return (
          <svg width={width} height={height}>
            <Group left={margin[3]} top={margin[0]}>
              <GridRows
                scale={yScale}
                numTicks={Math.min(maxYValue, 5)}
                width={xMax + barWidth / 2}
              />
              {graphData.map((d, i) => {
                const barX = xScale(getValidDate(d.name)) - barWidth / 2;
                let barHeight = yMax - (yScale(d.numExp) ?? 0);
                // if there are no experiments this month, show a little nub for design reasons.
                if (barHeight === 0) barHeight = 6;
                const barY = yMax - barHeight;
                return (
                  <BarRounded
                    key={d.name + i}
                    x={barX + 5}
                    y={barY}
                    width={Math.max(10, barWidth - 10)}
                    height={barHeight}
                    fill="#73D1F0"
                    top
                    radius={6}
                  />
                );
              })}

              <AxisBottom
                top={yMax}
                scale={xScale}
                numTicks={
                  width > 567
                    ? graphData.length
                    : Math.ceil(graphData.length / 2)
                }
                hideAxisLine={false}
                stroke={"#C2C5D6"}
                hideTicks={true}
                rangePadding={barWidth / 2}
                tickFormat={(v) => {
                  return format(v as Date, "LLL yyyy");
                }}
              />
              <AxisLeft
                scale={yScale}
                numTicks={Math.min(maxYValue, 5)}
                stroke={"#C2C5D6"}
                hideTicks={true}
                tickFormat={(v) => {
                  return Math.round(v as number) + "";
                }}
              />
            </Group>
          </svg>
        );
      }}
    </ParentSizeModern>
  );
}
