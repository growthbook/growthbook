import React from "react";
import { Group } from "@visx/group";
import { Arc, Line } from "@visx/shape";
import { LinearGradient } from "@visx/gradient";
import { ParentSize } from "@visx/responsive";
import { Text } from "@visx/text";
import { Box } from "@radix-ui/themes";

interface RateDialProps {
  winRate: number;
  height?: number;
  dialDegrees?: number;
  goodPercentLow?: number;
  goodPercentHigh?: number;
  outerArcRatio?: number;
  innerArcRatio?: number;
  circleRadiusRatio?: number;
  dialLengthRatio?: number;
  showTicks?: boolean;
  showPercent?: boolean;
  numPercents?: number;
  numTicks?: number;
}

const RateDial: React.FC<RateDialProps> = ({
  winRate,
  height = 220,
  dialDegrees = 250,
  goodPercentLow = 15,
  goodPercentHigh = 40,
  outerArcRatio = 0.95,
  innerArcRatio = 0.7,
  dialLengthRatio = 0.9,
  showTicks = true,
  showPercent = true,
  numPercents = 1,
  numTicks = 10,
}) => {
  const dialColorBase = "rgb(217,217,217)";
  const dialColorHighlight = "rgba(125,243,200,0.65)";
  const tickColor = "rgba(128,186,252,0.55)";

  const margin = { top: 20, right: 20, bottom: 20, left: 20 };
  const numDecimals = 0;

  return (
    <Box>
      <ParentSize>
        {({ width }) => {
          const heightRadius =
            height / (1 + Math.cos((Math.PI / 180) * (180 - dialDegrees / 2)));
          const radius = Math.min(
            (width - margin.left - margin.right) / 2,
            (dialDegrees < 180 ? height : heightRadius) -
              margin.top -
              margin.bottom,
          );

          const innerRadius = radius * innerArcRatio;
          const outerRadius = radius * outerArcRatio;
          const dialLineLength = radius * dialLengthRatio;

          const startAngleRad = (-1 * (dialDegrees / 2) * Math.PI) / 180;
          const endAngleRad = -startAngleRad;

          const percentToAngle = (percent: number) =>
            startAngleRad + ((endAngleRad - startAngleRad) * percent) / 100;

          const dialAngle = -1 * percentToAngle(winRate);

          // make sure that the dial is always in the right place and not rendered off the element
          const groupHeight =
            dialDegrees > 180 ? radius + margin.bottom : height - margin.bottom;

          // Generate tick marks and labels
          const ticks: React.ReactNode[] = [];
          const tickIncrement = 100 / numTicks;
          for (let i = 0; i <= 100; i += tickIncrement) {
            const angle = percentToAngle(i);
            const x1 = -1 * (outerRadius - 1) * Math.sin(angle);
            const y1 = -1 * (outerRadius - 1) * Math.cos(angle);
            const x2 = -1 * (outerRadius - 10) * Math.sin(angle);
            const y2 = -1 * (outerRadius - 10) * Math.cos(angle);
            ticks.push(
              <React.Fragment key={`tick-${i}`}>
                {showTicks && (
                  <Line
                    from={{ x: x1, y: y1 }}
                    to={{ x: x2, y: y2 }}
                    stroke={tickColor}
                    strokeWidth={1}
                  />
                )}
              </React.Fragment>,
            );
          }
          const percents: React.ReactNode[] = [];
          const percentIncrement = 100 / numPercents;
          for (let i = 0; i <= 100; i += percentIncrement) {
            const angle = percentToAngle(i);
            const xLabel = -1 * (outerRadius + 15) * Math.sin(angle);
            const yLabel = -1 * (outerRadius + 15) * Math.cos(angle);
            percents.push(
              <React.Fragment key={`tick-${i}`}>
                {showPercent && (
                  <Text
                    x={xLabel}
                    y={yLabel}
                    fontSize={10}
                    textAnchor="middle"
                    fill="var(--slate-10)"
                  >
                    {(100 - i).toString() + "%"}
                  </Text>
                )}
              </React.Fragment>,
            );
          }

          return (
            <svg width={width} height={height}>
              <defs>
                <LinearGradient
                  id="edgeblur1"
                  from={dialColorHighlight}
                  to={dialColorBase}
                  vertical={true}
                />
                <LinearGradient
                  id="edgeblur2"
                  from={dialColorHighlight}
                  to={dialColorBase}
                  vertical={false}
                />
              </defs>
              <Group
                top={groupHeight + (showPercent ? 10 : 0)}
                left={width / 2}
              >
                <Arc
                  startAngle={startAngleRad}
                  endAngle={endAngleRad}
                  innerRadius={innerRadius}
                  outerRadius={outerRadius}
                  fill={dialColorBase}
                />
                <Arc
                  startAngle={percentToAngle(goodPercentLow - 10)}
                  endAngle={percentToAngle(goodPercentLow)}
                  innerRadius={innerRadius}
                  outerRadius={outerRadius}
                  fill={"url(#edgeblur1)"}
                />
                <Arc
                  startAngle={percentToAngle(goodPercentHigh)}
                  endAngle={percentToAngle(goodPercentHigh + 10)}
                  innerRadius={innerRadius}
                  outerRadius={outerRadius}
                  fill={"url(#edgeblur2)"}
                />
                <Arc
                  startAngle={percentToAngle(goodPercentLow)}
                  endAngle={percentToAngle(goodPercentHigh)}
                  innerRadius={innerRadius}
                  outerRadius={outerRadius}
                  fill={dialColorHighlight}
                />
                {showTicks && (ticks as React.ReactNode)}
                {showPercent && (percents as React.ReactNode)}
                <Line
                  from={{
                    x: -1 * 5 * Math.sin(dialAngle),
                    y: -1 * 5 * Math.cos(dialAngle),
                  }}
                  to={{
                    x: -1 * dialLineLength * Math.sin(dialAngle),
                    y: -1 * dialLineLength * Math.cos(dialAngle),
                  }}
                  stroke="var(--blue-11)"
                  strokeWidth={6}
                  strokeLinecap="round"
                />
                <Text
                  x={0}
                  y={40}
                  fontSize={20}
                  fontWeight="500"
                  textAnchor="middle"
                  fill="var(--slate-12)"
                  dy={0}
                >
                  {winRate.toFixed(numDecimals) + "%"}
                </Text>
              </Group>
            </svg>
          );
        }}
      </ParentSize>
    </Box>
  );
};

export default RateDial;
