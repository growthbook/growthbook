//import { useState } from "react";
import useApi from "../../hooks/useApi";
import { RealtimeUsageInterface } from "back-end/types/realtime";
import { GridColumns, GridRows } from "@visx/grid";
import { AxisLeft, AxisBottom } from "@visx/axis";
import { LinePath } from "@visx/shape";
import { scaleLinear, scaleTime } from "@visx/scale";
import { ParentSizeModern } from "@visx/responsive";
import { Group } from "@visx/group";
import React, { Fragment } from "react";
import { curveMonotoneX } from "@visx/curve";
import { time } from "../../services/dates";

export default function RealTimeFeatures({
  numMinutes = 60,
  height = 220,
}: {
  numMinutes?: number;
  height?: number;
}) {
  //const [currentMin, setCurrentMin] = useState(new Date().getMinutes());
  const { data, error } = useApi<{
    realtime: { [key: number]: RealtimeUsageInterface };
  }>(`/realtime/features`);
  const { data: summaryData, error: summaryError } = useApi<{
    summary: RealtimeUsageInterface[];
  }>(`/realtime/summary`);

  if (!data || !summaryData || error || summaryError) {
    return null;
  }

  const points: { [key: string]: { time: number; value: number }[] } = {};
  Object.keys(data.realtime).forEach((h) => {
    Object.keys(data.realtime[h].counts).forEach((t) => {
      if (!(t in points)) {
        points[t] = [];
      }
      Object.keys(data.realtime[h].counts).forEach((t) => {
        const minutes = data.realtime[h].counts[t].minutes;
        Object.keys(minutes).forEach((m) => {
          const d = new Date(data.realtime[h].hour * 1000);
          d.setMinutes(parseInt(m));
          points[t].push({
            time: d.getTime(),
            value: parseInt(minutes[m]),
          });
        });
      });
    });
  });

  // sort and get max value:
  let maxValue = 0;
  Object.keys(points).forEach((k) => {
    const thisMaxV = Math.max(...points[k].map((d) => d.value));
    if (thisMaxV > maxValue) maxValue = thisMaxV;
    points[k].sort((a, b) => {
      return a.time > b.time ? 1 : -1;
    });
    // truncate if needed:
    if (points[k].length > numMinutes) {
      points[k] = points[k].slice(points[k].length - numMinutes);
    }
  });

  const margin = [15, 15, 30, 80];
  const allFeatures = Object.keys(points).map((key) => points[key]);
  if (!allFeatures?.length) {
    return null;
  }
  const min = Math.min(...allFeatures[0].map((d) => d.time));
  const max = Math.max(...allFeatures[0].map((d) => d.time));

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
                  <LinePath
                    data={points["_overall"]}
                    x={(d) => xScale(d.time) ?? 0}
                    y={(d) => yScale(d.value) ?? 0}
                    stroke={"#8884d8"}
                    strokeWidth={2}
                    curve={curveMonotoneX}
                  />

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
