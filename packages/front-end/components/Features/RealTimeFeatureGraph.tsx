//import { useState } from "react";
import useApi from "../../hooks/useApi";
import { RealtimeUsageInterface } from "back-end/types/realtime";
import { GridColumns, GridRows } from "@visx/grid";
import { AxisLeft, AxisBottom } from "@visx/axis";
import { LinePath, AreaClosed } from "@visx/shape";
import { scaleLinear, scaleTime } from "@visx/scale";
import { ParentSizeModern } from "@visx/responsive";
import { Group } from "@visx/group";
import React, { Fragment } from "react";
import { curveMonotoneX } from "@visx/curve";
import { time } from "../../services/dates";

export default function RealTimeFeatureGraph({
  featureId,
  numMinutes = 60,
  width = "auto",
  height = 220,
  areaColor = "#3aa8e8",
  strokeColor = "#8884d8",
  graphType = "normal",
  autoUpdate = true,
}: {
  featureId: string;
  numMinutes?: number;
  width?: "auto" | string;
  height?: number;
  areaColor?: string;
  strokeColor?: string;
  graphType?: "normal" | "spark";
  autoUpdate?: boolean;
}) {
  //const [currentMin, setCurrentMin] = useState(new Date().getMinutes());
  const { data, error, mutate } = useApi<{
    realtime: { [key: number]: RealtimeUsageInterface };
  }>(`/realtime/features`);

  if (error) {
    return null;
  }
  if (autoUpdate) {
    setTimeout(() => {
      mutate();
    }, 60 * 1000);
  }
  if (!data) {
    return null;
  }

  const timeMap = new Map();
  // prefill time map with zeros:
  let hasData = false;
  const currentMinute = new Date().getMinutes();
  for (let i = 0; i < numMinutes; i++) {
    const currentTime = new Date().setMinutes(currentMinute - i, 0, 0);
    timeMap.set(currentTime, { time: currentTime, value: 0 });
  }
  Object.keys(data.realtime).forEach((h) => {
    Object.keys(data.realtime[h].counts).forEach((t) => {
      if (t === featureId) {
        const minutes = data.realtime[h].counts[t].minutes;
        Object.keys(minutes).forEach((m) => {
          hasData = true;
          const d = new Date(data.realtime[h].hour * 1000);
          d.setMinutes(parseInt(m));
          timeMap.set(d.getTime(), {
            time: d.getTime(),
            value: parseInt(minutes[m]),
          });
        });
      }
    });
  });

  let points = Array.from(timeMap.values());
  // sort and get max value:
  let maxValue = 0;
  const thisMaxV = Math.max(...points.map((d) => d.value));
  if (thisMaxV > maxValue) maxValue = thisMaxV;
  points.sort((a, b) => {
    return a.time > b.time ? 1 : -1;
  });
  // truncate if needed:
  if (points.length > numMinutes) {
    points = points.slice(points.length - numMinutes);
  }

  const margin = [0, 0, 0, 0];
  const min = Math.min(...points.map((d) => d.time));
  const max = Math.max(...points.map((d) => d.time));

  return (
    <div style={{ width: width }}>
      <ParentSizeModern style={{ position: "relative" }}>
        {({ width }) => {
          const yMax = height - margin[0] - margin[2];
          const xMax = width - margin[1] - margin[3];
          const numXTicks = width > 768 ? 7 : 4;
          const numYTicks = 5;
          const graphHeight = yMax;

          const xScale = scaleTime({
            domain: [min, max],
            range: [0, xMax],
            round: true,
          });
          const yScale = scaleLinear<number>({
            domain: [0, maxValue || 10],
            range: [graphHeight, 0],
            round: true,
          });

          return (
            <>
              {!hasData && (
                <div
                  style={{
                    position: "absolute",
                    left: "50%",
                    marginLeft: "-15%",
                    fontSize: "10px",
                    color: "#9a9a9a",
                  }}
                >
                  No data
                </div>
              )}
              <svg width={width} height={height}>
                <Group left={margin[3]} top={margin[0]}>
                  {graphType !== "spark" && (
                    <>
                      <GridRows
                        scale={yScale}
                        width={xMax}
                        numTicks={numYTicks}
                      />
                      <GridColumns
                        scale={xScale}
                        height={graphHeight}
                        numTicks={numXTicks}
                      />
                    </>
                  )}
                  <AreaClosed
                    data={points}
                    x={(d) => xScale(d.time) ?? 0}
                    y={(d) => yScale(d.value) ?? 0}
                    yScale={yScale}
                    curve={curveMonotoneX}
                    fill={areaColor}
                    fillOpacity={0.2}
                  />
                  <LinePath
                    data={points}
                    x={(d) => xScale(d.time) ?? 0}
                    y={(d) => yScale(d.value) ?? 0}
                    stroke={strokeColor}
                    strokeWidth={graphType === "spark" ? 1 : 2}
                    curve={curveMonotoneX}
                  />

                  <AxisBottom
                    top={graphHeight}
                    scale={xScale}
                    numTicks={graphType === "spark" ? 0 : numXTicks}
                    tickFormat={(d) => {
                      return time(d as Date);
                    }}
                  />
                  {graphType !== "spark" && (
                    <AxisLeft scale={yScale} numTicks={numYTicks} />
                  )}
                </Group>
              </svg>
            </>
          );
        }}
      </ParentSizeModern>
    </div>
  );
}
