import useApi from "../../hooks/useApi";
import { RealtimeUsageInterface } from "back-end/types/realtime";
import { GridColumns, GridRows } from "@visx/grid";
import { AxisLeft, AxisBottom } from "@visx/axis";
import { LinePath, AreaClosed, AreaStack } from "@visx/shape";
import { scaleLinear, scaleTime } from "@visx/scale";
import { ParentSizeModern } from "@visx/responsive";
import { Group } from "@visx/group";
import React from "react";
import { curveMonotoneX } from "@visx/curve";
import { time } from "../../services/dates";

export default function RealTimeFeatures({
  numMinutes = 60,
  height = 220,
  autoUpdate = false,
  margin = [15, 15, 30, 80],
  graphType = "stacked",
  includeOverall = false,
}: {
  numMinutes?: number;
  height?: number;
  autoUpdate?: boolean;
  margin?: [number, number, number, number];
  graphType?: "stacked" | "area" | "lines";
  includeOverall?: boolean;
}) {
  const { data, error, mutate } = useApi<{
    realtime: { [key: number]: RealtimeUsageInterface };
  }>(`/realtime/features`);
  // const { data: summaryData, error: summaryError } = useApi<{
  //   summary: RealtimeUsageInterface[];
  // }>(`/realtime/summary`);

  const colors = [
    "#1d63ea",
    "#a51ef3",
    "#ea8a1d",
    "#0a7410",
    "#06a9bd",
    "#eae01d",
    "#a12632",
    "#065280",
    "#680259",
    "#0921a0",
    "#efe97e",
  ];

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

  // At the end of this we want an array of objects, with one array element per minute
  // [{ time: <timestamp>, _overall: <number>, feature-key-1: <number>}, {...}]
  // for the graphing calls to render. We'll use a map to help with this
  const timeMap = new Map();
  let hasData = false;
  // prefill time map with zeros:
  const currentMinute = new Date().getMinutes();
  let max = 0;
  let min = 0;
  for (let i = 0; i < numMinutes; i++) {
    const currentTime = new Date().setMinutes(currentMinute - i, 0, 0);
    timeMap.set(currentTime, { time: currentTime });
    // while we're here, get the time domain for the x-axis.
    if (i === 0) max = currentTime;
    if (i === numMinutes - 1) min = currentTime;
  }
  let maxValue = 0;
  const keyMap = new Map();
  Object.keys(data.realtime).forEach((h) => {
    const d = new Date(data.realtime[h].hour * 1000);
    Object.keys(data.realtime[h].counts).forEach((featureKey) => {
      const minutes = data.realtime[h].counts[featureKey].minutes;
      if (graphType === "stacked" && featureKey === "_overall") {
        // need to get the max height for the stacked data:
        Object.keys(minutes).forEach((m) => {
          if (parseInt(minutes[m]) > maxValue) maxValue = parseInt(minutes[m]);
        });
      }
      if (!includeOverall && featureKey === "_overall") {
        // don't include overall when asked not to
        return;
      }
      keyMap.set(featureKey, 1);
      Object.keys(minutes).forEach((m) => {
        const currentTime = d.setMinutes(parseInt(m));
        if (timeMap.has(currentTime)) {
          hasData = true;
          const currentValues = timeMap.get(currentTime);
          currentValues[featureKey] = parseInt(minutes[m]);
          timeMap.set(currentTime, currentValues);
        }
        if (parseInt(minutes[m]) > maxValue) maxValue = parseInt(minutes[m]);
      });
    });
  });

  //convert to arrays.
  const points = Array.from(timeMap.values());
  const keys = Array.from(keyMap.keys());

  // sort
  points.sort((a, b) => {
    return a.time > b.time ? 1 : -1;
  });

  if (!hasData) {
    return null;
  }

  const colorMap = new Map();
  keys.forEach((k, i) => {
    const colorIndex = i % colors.length;
    colorMap.set(k, colors[colorIndex]);
  });

  return (
    <div>
      <h3>Overall Flag Usage</h3>
      <ParentSizeModern style={{ position: "relative" }}>
        {({ width }) => {
          const yMax = height - margin[0] - margin[2];
          const xMax = width - margin[1] - margin[3];
          const numXTicks = width > 768 ? 7 : 4;
          const numYTicks = 5;
          const minGraphHeight = 100;
          let graphHeight = yMax;
          if (graphHeight < minGraphHeight) {
            height += minGraphHeight - yMax;
            graphHeight = minGraphHeight;
          }

          const xScale = scaleTime({
            domain: [min, max],
            range: [0, xMax],
            round: true,
          });
          const yScale = scaleLinear<number>({
            domain: [0, maxValue],
            range: [graphHeight, 0],
            round: true,
          });
          return (
            <>
              <svg width={width} height={height}>
                <Group left={margin[3]} top={margin[0]}>
                  <GridRows scale={yScale} width={xMax} numTicks={numYTicks} />
                  <GridColumns
                    scale={xScale}
                    height={graphHeight}
                    numTicks={numXTicks}
                  />
                  {graphType === "stacked" && (
                    <AreaStack
                      top={margin[0]}
                      left={margin[3]}
                      keys={keys}
                      data={points}
                      x={(d) => {
                        return xScale(d.data.time) ?? 0;
                      }}
                      y0={(d) => yScale(d[0]) ?? 0}
                      y1={(d) => yScale(d[1]) ?? 0}
                    >
                      {({ stacks, path }) => {
                        return stacks.map((stack) => {
                          return (
                            <path
                              key={`stack-${stack.key}`}
                              d={path(stack) || ""}
                              strokeWidth={0}
                              stroke={"#fff"}
                              fill={colorMap.get(stack.key)}
                              fillOpacity={0.6}
                              strokeLinecap="round"
                            />
                            // can't get this to work, even though it extends <path>
                            // <LinePath
                            //   key={`stack-${stack.key}`}
                            //   data={stack}
                            //   x={(d) => d[0] ?? 0}
                            //   y={(d) => { console.log(d); return d[1] ?? 0 }}
                            //   stroke={"#8884d8"}
                            //   strokeWidth={2}
                            //   curve={curveMonotoneX}
                            // />
                          );
                        });
                      }}
                    </AreaStack>
                  )}
                  {graphType === "area" && (
                    <>
                      {keys.map((k) => {
                        return (
                          <AreaClosed
                            key={k}
                            data={points}
                            x={(d) => xScale(d.time) ?? 0}
                            y={(d) => yScale(d[k]) ?? 0}
                            yScale={yScale}
                            strokeWidth={1}
                            stroke={colorMap.get(k)}
                            curve={curveMonotoneX}
                            fill={colorMap.get(k)}
                            fillOpacity={0.2}
                          />
                        );
                      })}
                    </>
                  )}
                  {graphType === "lines" && (
                    <>
                      {keys.map((k) => {
                        return (
                          <LinePath
                            key={k}
                            data={points}
                            x={(d) => xScale(d.time) ?? 0}
                            y={(d) => yScale(d[k]) ?? 0}
                            stroke={colorMap.get(k)}
                            strokeWidth={2}
                            curve={curveMonotoneX}
                          />
                        );
                      })}
                    </>
                  )}
                  <AxisBottom
                    top={graphHeight}
                    scale={xScale}
                    numTicks={numXTicks}
                    tickFormat={(d) => {
                      return time(d as Date);
                    }}
                  />
                  <AxisLeft scale={yScale} numTicks={numYTicks} />
                </Group>
              </svg>
            </>
          );
        }}
      </ParentSizeModern>
    </div>
  );
}
