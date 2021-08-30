import React from "react";
import useApi from "../../hooks/useApi";
import LoadingOverlay from "../LoadingOverlay";
import { Bar } from "@visx/shape";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { Group } from "@visx/group";
import { ParentSizeModern } from "@visx/responsive";
import { scaleLinear, scaleTime } from "@visx/scale";
import { GridRows } from "@visx/grid";
import format from "date-fns/format";

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
  const { data, error } = useApi<{
    data: {
      all: { name: string; numExp: number }[];
      draft: { name: string; numExp: number }[];
      running: { name: string; numExp: number }[];
      stopped: { name: string; numExp: number }[];
    };
  }>(`/experiments/frequency/${resolution}/${num}`);

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

  const firstMonth = new Date(graphData[0].name);
  const lastMonth = new Date(graphData[graphData.length - 1].name);

  return (
    <ParentSizeModern>
      {({ width }) => {
        const margin = [15, 40, 30, 30];
        const yMax = height - margin[0] - margin[2];
        const xMax = width - margin[1] - margin[3];

        const barWidth = Math.round(xMax / (graphData.length + 1));
        const xScale = scaleTime({
          domain: [firstMonth, lastMonth],
          range: [barWidth / 2, xMax],
          round: true,
        });
        const yScale = scaleLinear<number>({
          domain: [
            Math.min(...graphData.map((d) => d.numExp)),
            Math.max(...graphData.map((d) => d.numExp)),
          ],
          range: [yMax, 0],
          round: true,
        });

        return (
          <svg width={width} height={height}>
            <Group left={margin[3]} top={margin[0]}>
              <GridRows
                scale={yScale}
                numTicks={5}
                width={xMax + barWidth / 2}
              />
              {graphData.map((d, i) => {
                const barX = xScale(new Date(d.name)) - barWidth / 2;
                const barHeight = yMax - (yScale(d.numExp) ?? 0);
                const barY = yMax - barHeight;
                return (
                  <Bar
                    key={d.name + i}
                    x={barX + 5}
                    y={barY}
                    width={barWidth - 10}
                    height={barHeight}
                    fill="#029dd1"
                  />
                );
              })}

              <AxisBottom
                top={yMax}
                scale={xScale}
                numTicks={
                  width > 767
                    ? graphData.length
                    : Math.ceil(graphData.length / 2)
                }
                hideAxisLine={true}
                tickFormat={(v) => {
                  return format(v as Date, "LLL yyyy");
                }}
              />
              <AxisLeft scale={yScale} numTicks={5} hideAxisLine />
            </Group>
          </svg>
        );
      }}
    </ParentSizeModern>
  );
}
