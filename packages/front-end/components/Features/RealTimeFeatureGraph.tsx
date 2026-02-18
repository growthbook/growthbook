import { AxisBottom } from "@visx/axis";
import { AreaStack } from "@visx/shape";
import { scaleLinear, scaleTime } from "@visx/scale";
import { ParentSize } from "@visx/responsive";
import { Group } from "@visx/group";
import React from "react";
import { FeatureRealtimeUsageRecord } from "shared/types/realtime";

const usedColor = "#3aa8e8";
const skippedColor = "#cccccc";

export default function RealTimeFeatureGraph({
  data,
  width = "150px",
  height = 25,
  yDomain = [0, 10],
}: {
  yDomain: [number, number];
  data: FeatureRealtimeUsageRecord[];
  width?: "auto" | string;
  height?: number;
}) {
  const margin = [0, 0, 0, 0];

  const maxCombined = Math.max(0, ...data.map((d) => d.used + d.skipped));
  const xDomain = [0, data.length];

  return (
    <div style={{ width: width }}>
      <ParentSize style={{ position: "relative" }}>
        {({ width }) => {
          const yMax = height - margin[0] - margin[2];
          const xMax = width - margin[1] - margin[3];
          const graphHeight = yMax;

          const xScale = scaleTime({
            domain: xDomain,
            range: [0, xMax],
            round: true,
          });
          const yScale = scaleLinear<number>({
            domain: yDomain,
            range: [graphHeight, 0],
            round: true,
          });

          return (
            <>
              {!maxCombined && (
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
                  {maxCombined > 0 && (
                    <AreaStack
                      data={data}
                      keys={["used", "skipped"]}
                      x={(d, i) => xScale(i)}
                      y0={(d) => yScale(d[0]) ?? 0}
                      y1={(d) => yScale(d[1]) ?? 0}
                    >
                      {({ stacks, path }) =>
                        stacks.map((stack) => (
                          <path
                            key={`stack-${stack.key}`}
                            d={path(stack) || ""}
                            stroke="transparent"
                            fill={
                              stack.key === "used" ? usedColor : skippedColor
                            }
                          />
                        ))
                      }
                    </AreaStack>
                  )}
                  <AxisBottom
                    top={graphHeight}
                    scale={xScale}
                    numTicks={0}
                    label={""}
                  />
                </Group>
              </svg>
            </>
          );
        }}
      </ParentSize>
    </div>
  );
}
