//import { useState } from "react";
import useApi from "../../hooks/useApi";
import styles from "./RealTimeFeatureGraph.module.scss";
import { RealtimeUsageInterface } from "back-end/types/realtime";
import { GridColumns, GridRows } from "@visx/grid";
import { AxisLeft, AxisBottom } from "@visx/axis";
import { LinePath, AreaClosed } from "@visx/shape";
import { scaleLinear, scaleTime } from "@visx/scale";
import { ParentSizeModern } from "@visx/responsive";
import { Group } from "@visx/group";
import React from "react";
import { curveMonotoneX, curveStep } from "@visx/curve";
import { time } from "../../services/dates";
import {
  TooltipWithBounds,
  useTooltip,
  useTooltipInPortal,
} from "@visx/tooltip";

type TooltipData = { x: number; y: number; d: Datapoint };
interface Datapoint {
  time: Date | number;
  value: number;
}

export default function RealTimeFeatureGraph({
  featureId,
  numMinutes = 60,
  width = "auto",
  height = 220,
  areaColor = "#3aa8e8",
  strokeColor = "#8884d8",
  graphType = "normal",
  curve = "step",
  autoUpdate = true,
}: {
  featureId: string;
  numMinutes?: number;
  width?: "auto" | string;
  height?: number;
  areaColor?: string;
  strokeColor?: string;
  graphType?: "normal" | "spark";
  curve?: "curve" | "step";
  autoUpdate?: boolean;
}) {
  //const [currentMin, setCurrentMin] = useState(new Date().getMinutes());
  const { data, error, mutate } = useApi<{
    realtime: { [key: number]: RealtimeUsageInterface };
  }>(`/realtime/features`);

  const margin = graphType === "spark" ? [0, 0, 0, 0] : [10, 20, 40, 50];

  const { containerRef, containerBounds } = useTooltipInPortal({
    scroll: true,
    detectBounds: true,
  });

  const {
    showTooltip,
    hideTooltip,
    tooltipOpen,
    tooltipData,
    tooltipLeft = 0,
    tooltipTop = 0,
  } = useTooltip<TooltipData>();

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

  const min = Math.min(...points.map((d) => d.time));
  const max = Math.max(...points.map((d) => d.time));

  const getTooltipData = (mx: number, width: number, yScale): TooltipData => {
    const innerWidth =
      width - margin[1] - margin[3] + width / points.length - 1;
    const px = mx / innerWidth;
    const index = Math.max(
      Math.min(Math.round(px * points.length), points.length - 1),
      0
    );
    const d = points[index];
    const x = (points.length > 0 ? index / points.length : 0) * innerWidth;
    const y = yScale(d.value) ?? 0;
    return { x, y, d };
  };

  const getTooltipContents = (d: Datapoint) => {
    return (
      <>
        <div className={styles.date}>{time(d.time as Date)}</div>
        <div className={styles.val}>{d.value}</div>
      </>
    );
  };

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

          const handlePointer = (event: React.PointerEvent<HTMLDivElement>) => {
            // coordinates should be relative to the container in which Tooltip is rendered
            const containerX =
              ("clientX" in event ? event.clientX : 0) - containerBounds.left;
            const data = getTooltipData(containerX, width, yScale);
            showTooltip({
              tooltipLeft: data.x,
              tooltipTop: data.y,
              tooltipData: data,
            });
          };

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
              <div
                ref={containerRef}
                className={styles.tooltipDategraph}
                style={{
                  width: xMax,
                  height: graphHeight,
                  marginLeft: margin[3],
                  marginTop: margin[0],
                }}
                onPointerMove={handlePointer}
                onPointerLeave={hideTooltip}
              >
                {tooltipOpen && graphType !== "spark" && (
                  <>
                    <div
                      className={styles.positionIndicator}
                      style={{
                        transform: `translate(${tooltipLeft}px, ${tooltipTop}px)`,
                      }}
                    />
                    <div
                      className={styles.crosshair}
                      style={{ transform: `translateX(${tooltipLeft}px)` }}
                    />
                    <TooltipWithBounds
                      left={tooltipLeft}
                      top={tooltipTop}
                      className={styles.tooltip}
                      unstyled={true}
                    >
                      {getTooltipContents(tooltipData.d)}
                    </TooltipWithBounds>
                  </>
                )}
              </div>
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
                  {graphType !== "spark" && (
                    <AreaClosed
                      data={points}
                      x={(d) => xScale(d.time) ?? 0}
                      y={(d) => yScale(d.value) ?? 0}
                      yScale={yScale}
                      curve={curve === "step" ? curveStep : curveMonotoneX}
                      stroke={strokeColor}
                      fill={areaColor}
                      fillOpacity={0.2}
                    />
                  )}
                  {graphType === "spark" && (
                    <>
                      <AreaClosed
                        data={points}
                        x={(d) => xScale(d.time) ?? 0}
                        y={(d) => yScale(d.value) ?? 0}
                        yScale={yScale}
                        curve={curve === "step" ? curveStep : curveMonotoneX}
                        fill={areaColor}
                        fillOpacity={0.2}
                      />
                      <LinePath
                        data={points}
                        x={(d) => xScale(d.time) ?? 0}
                        y={(d) => yScale(d.value) ?? 0}
                        stroke={strokeColor}
                        strokeWidth={graphType === "spark" ? 1 : 2}
                        curve={curve === "step" ? curveStep : curveMonotoneX}
                      />
                    </>
                  )}

                  <AxisBottom
                    top={graphHeight}
                    scale={xScale}
                    numTicks={graphType === "spark" ? 0 : numXTicks}
                    tickFormat={(d) => {
                      return time(d as Date);
                    }}
                    label={
                      graphType === "spark" ? "" : `Last ${numMinutes} minutes`
                    }
                  />
                  {graphType !== "spark" && (
                    <AxisLeft
                      scale={yScale}
                      numTicks={numYTicks}
                      label={"count"}
                    />
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
