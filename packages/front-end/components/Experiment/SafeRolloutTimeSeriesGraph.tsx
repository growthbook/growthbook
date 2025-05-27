import React, { useMemo } from "react";
import { extent } from "@visx/vendor/d3-array";
import { Group } from "@visx/group";
import { Line, LinePath } from "@visx/shape";
import { scaleTime, scaleLinear } from "@visx/scale";
import { ParentSize } from "@visx/responsive";
import { useTooltip, useTooltipInPortal } from "@visx/tooltip";
import { localPoint } from "@visx/event";
import { curveLinear } from "@visx/curve";
import { Flex, Text } from "@radix-ui/themes";
import { MetricTimeSeries } from "back-end/src/validators/metric-time-series";
import { datetime, getValidDate } from "shared/dates";
import { RadixTheme } from "@/services/RadixTheme";
import Table, {
  TableBody,
  TableRow,
  TableRowHeaderCell,
} from "@/components/Radix/Table";
import styles from "./SafeRolloutTimeSeriesGraph.module.scss";

type SafeRolloutTimeSeriesGraphProps = {
  data: MetricTimeSeries;
  xExtent?: [undefined, undefined] | [Date, Date];
};

export default function SafeRolloutTimeSeriesGraph({
  data,
  xExtent,
}: SafeRolloutTimeSeriesGraphProps) {
  return (
    <ParentSize>
      {({ width, height }) => (
        <SafeRolloutTimeSeriesGraphContent
          data={data}
          xExtent={xExtent}
          width={width}
          height={height}
        />
      )}
    </ParentSize>
  );
}

type VariationData = {
  name: string;
  ci: [number | null, number | null];
};

type DataPoint = {
  date: Date;
  variations: VariationData[];
};

const SafeRolloutTimeSeriesGraphContent = ({
  data,
  xExtent,
  width,
  height,
}: SafeRolloutTimeSeriesGraphProps & { width: number; height: number }) => {
  const {
    tooltipData,
    tooltipLeft,
    tooltipTop,
    tooltipOpen,
    showTooltip,
    hideTooltip,
  } = useTooltip<{
    datum: DataPoint;
    index: number;
  }>();

  const { containerRef, TooltipInPortal } = useTooltipInPortal({
    detectBounds: true,
    scroll: true,
  });

  const dataPointsToRender: DataPoint[] = useMemo(() => {
    return data.dataPoints.map((dp) => ({
      date: getValidDate(dp.date),
      variations: dp.variations.map((v) => ({
        name: v.name,
        ci: v.absolute?.ci ?? [null, null],
      })),
    }));
  }, [data.dataPoints]);

  // Calculate y scale based only on the non-null CI values being rendered
  const ciValuesToRender = dataPointsToRender.flatMap((d) => {
    const ciResult = getNonInfiniteSideOfCI(d.variations[1]);
    return ciResult.value !== null ? [ciResult.value] : [];
  });

  // Always include 0 in the domain (for the zero line)
  ciValuesToRender.push(0);

  const yExtent = extent(ciValuesToRender);
  const yMin = yExtent[0] || 0;
  const yMax = yExtent[1] || 0;

  const innerWidth = width;
  const innerHeight = height;

  // Add padding to the scale to better distinguish values near zero
  const yPadding = (yMax - yMin) * 0.15;
  const yScale = scaleLinear<number>({
    domain: [yMin - yPadding, yMax + yPadding],
    range: [innerHeight, 0],
  });

  // Create x scale for time with horizontal padding
  const xExtentToUse = xExtent || extent(dataPointsToRender, (d) => d.date);
  if (!xExtentToUse || xExtentToUse[0] === undefined) return null;

  const timeRange = xExtentToUse[1].getTime() - xExtentToUse[0].getTime();
  const xPadding = timeRange * 0.05; // 5% padding on each side

  const xScale = scaleTime<number>({
    domain: [
      new Date(xExtentToUse[0].getTime() - xPadding),
      new Date(xExtentToUse[1].getTime() + xPadding),
    ],
    range: [0, innerWidth],
  });

  // Calculate the y position for the zero line
  const zeroY = yScale(0);

  // Extract CI line data points (non-infinite side)
  const ciLineData = dataPointsToRender
    .flatMap((d) => {
      const ciResult = getNonInfiniteSideOfCI(d.variations[1]);

      // Determine if this CI value is on the "wrong" side of zero
      // For [-Infinity, value] format, it's negative when value < 0
      // For [value, Infinity] format, it's negative when value > 0
      const isNegative =
        ciResult.value !== null &&
        ((ciResult.isUpperBound && ciResult.value < 0) ||
          (!ciResult.isUpperBound && ciResult.value > 0));

      return {
        x: xScale(d.date),
        y: yScale(ciResult.value ?? 0),
        hasCi: ciResult.value !== null,
        isNegative,
        datum: d,
      };
    })
    .filter((d) => d.hasCi);

  const handleMouseMove = (event: React.MouseEvent) => {
    const coords = localPoint(event);
    if (!coords) return;

    const x = xScale.invert(coords.x);
    let closestPoint = { index: 0, distance: Infinity };

    ciLineData.forEach((point, i) => {
      const pointX = xScale.invert(point.x);
      const distance = Math.abs(pointX.getTime() - x.getTime());

      if (distance < closestPoint.distance) {
        closestPoint = { index: i, distance };
      }
    });

    // Show tooltip for the closest point
    if (ciLineData[closestPoint.index]) {
      showTooltip({
        tooltipData: {
          datum: ciLineData[closestPoint.index].datum,
          index: closestPoint.index,
        },
        tooltipLeft: coords.x,
        tooltipTop: coords.y,
      });
    }
  };

  return (
    <>
      <svg
        ref={containerRef}
        width={width}
        height={height}
        onMouseMove={handleMouseMove}
        onMouseLeave={hideTooltip}
      >
        <Group>
          <rect
            x={0}
            y={0}
            width={innerWidth}
            height={innerHeight}
            fill="transparent"
          />

          {/* Zero line */}
          {zeroY >= 0 && zeroY <= innerHeight && (
            <Line
              from={{ x: 0, y: zeroY }}
              to={{ x: innerWidth, y: zeroY }}
              stroke="var(--slate-a7)"
              strokeWidth={1}
              strokeDasharray="6,4"
              strokeLinecap="butt"
            />
          )}

          {/* CI line for rollout variation */}
          {ciLineData.length > 0 && (
            <>
              {/* This logic breaks the lines in segments so we can render everything on the failing side of the zero line as red */}
              {(() => {
                const segments: {
                  points: typeof ciLineData;
                  isNegative: boolean;
                }[] = [];
                let currentSegment: typeof ciLineData = [];
                let currentIsNegative = ciLineData[0]?.isNegative || false;

                // Group points into segments by sign
                ciLineData.forEach((point, i) => {
                  // If sign changed, calculate zero crossing point and add to both segments
                  if (i > 0 && point.isNegative !== currentIsNegative) {
                    const prevPoint = ciLineData[i - 1];

                    // Calculate where line crosses y=0
                    const zeroY = yScale(0);
                    const ratio = Math.abs(
                      (prevPoint.y - zeroY) / (prevPoint.y - point.y)
                    );
                    const crossingX =
                      prevPoint.x + ratio * (point.x - prevPoint.x);

                    // Add crossing point to current segment
                    currentSegment.push({
                      x: crossingX,
                      y: zeroY,
                      hasCi: true,
                      isNegative: currentIsNegative,
                      datum: point.datum,
                    });

                    // Save current segment
                    segments.push({
                      points: [...currentSegment],
                      isNegative: currentIsNegative,
                    });

                    // Start new segment with crossing point
                    currentSegment = [
                      {
                        x: crossingX,
                        y: zeroY,
                        hasCi: true,
                        isNegative: point.isNegative,
                        datum: point.datum,
                      },
                    ];
                    currentIsNegative = point.isNegative;
                  }

                  // Add point to current segment
                  currentSegment.push(point);
                });

                // Add the last segment
                if (currentSegment.length > 0) {
                  segments.push({
                    points: currentSegment,
                    isNegative: currentIsNegative,
                  });
                }

                // Render each segment with appropriate color
                return segments.map((segment, i) => (
                  <LinePath
                    key={`segment-${i}`}
                    data={segment.points}
                    x={(d) => d.x}
                    y={(d) => d.y}
                    stroke={
                      segment.isNegative ? "var(--red-11)" : "var(--teal-11)"
                    }
                    strokeWidth={1.6}
                    curve={curveLinear}
                  />
                ));
              })()}
            </>
          )}

          {/* Render single points as visible circles */}
          {ciLineData.length === 1 && (
            <circle
              cx={ciLineData[0].x}
              cy={ciLineData[0].y}
              r={4}
              fill={
                ciLineData[0].isNegative ? "var(--red-11)" : "var(--teal-11)"
              }
              stroke="white"
              strokeWidth={2}
              pointerEvents="none"
            />
          )}

          {/* Visible circle for active tooltip point */}
          {tooltipOpen &&
            tooltipData &&
            tooltipLeft != null &&
            tooltipTop != null && (
              <>
                {(() => {
                  const activePoint = ciLineData[tooltipData.index];
                  if (!activePoint) return null;

                  return (
                    <circle
                      cx={activePoint.x}
                      cy={activePoint.y}
                      r={4}
                      fill="white"
                      stroke={activePoint.isNegative ? "#EF4444" : "#000000"}
                      strokeWidth={2}
                      pointerEvents="none"
                    />
                  );
                })()}
              </>
            )}
        </Group>
      </svg>

      {tooltipOpen && tooltipData && tooltipLeft != null && tooltipTop != null && (
        <TooltipInPortal
          key={Math.random()} // Force update on each render
          top={tooltipTop}
          left={tooltipLeft}
          unstyled={true}
          className={styles.tooltip}
        >
          <RadixTheme>
            <div className={styles.tooltipContent}>
              {getTooltipContent(tooltipData)}
            </div>
          </RadixTheme>
        </TooltipInPortal>
      )}
    </>
  );
};

function getTooltipContent(tooltipData: { datum: DataPoint; index: number }) {
  const rolloutVariation = tooltipData.datum.variations?.find(
    (v) =>
      v.name.toLowerCase().includes("variation") ||
      v.name.toLowerCase().includes("rollout")
  );

  if (!rolloutVariation) return null;

  const ci = getNonInfiniteSideOfCI(rolloutVariation);

  // Determine if this represents a regression (negative outcome)
  const isRegression =
    (ci.isUpperBound && (ci.value ?? 0) < 0) ||
    (!ci.isUpperBound && (ci.value ?? 0) > 0);

  const getStatusInfo = () => {
    if (isRegression) {
      return {
        status: "Failing",
        color: "var(--red-11)",
        description:
          "The metric confidence interval crossed the boundary, meaning we are 97.5% confident this is a regression. Consider rolling back immediately.",
      };
    } else {
      return {
        status: "Within bounds",
        color: "var(--teal-11)",
        description:
          "No regression detected. If this metric crosses the confidence boundary we will consider it is failing.",
      };
    }
  };

  const statusInfo = getStatusInfo();

  return (
    <>
      <Flex direction="column" gap="2" mb="2">
        <Text weight="medium">{datetime(tooltipData.datum.date)}</Text>
        <Flex align="center" gap="2">
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              backgroundColor: statusInfo.color,
            }}
          />
          <Text weight="medium" style={{ color: statusInfo.color }}>
            {statusInfo.status}
          </Text>
        </Flex>
        <Text
          size="1"
          style={{ color: "var(--color-text-medium)", maxWidth: 325 }}
        >
          {statusInfo.description}
        </Text>
      </Flex>

      <Table size="1">
        <TableBody>
          <TableRow
            style={{ color: "var(--color-text-high)", fontWeight: 500 }}
          >
            <TableRowHeaderCell pl="0">Confidence</TableRowHeaderCell>
            <TableRowHeaderCell>
              {ci.value !== null ? ci.value.toFixed(4) : "N/A"}
            </TableRowHeaderCell>
          </TableRow>
          <TableRow
            style={{ color: "var(--color-text-high)", fontWeight: 500 }}
          >
            <TableRowHeaderCell pl="0">Confidence Boundary</TableRowHeaderCell>
            <TableRowHeaderCell>0</TableRowHeaderCell>
          </TableRow>
        </TableBody>
      </Table>
    </>
  );
}

const getNonInfiniteSideOfCI = (
  variation: VariationData | undefined
): { value: number | null; isUpperBound: boolean } => {
  if (!variation || !variation.ci) return { value: null, isUpperBound: false };

  // Check if we have a [-Infinity, value] structure
  if (variation.ci[0] === -Infinity || variation.ci[0] === null) {
    return {
      value: variation.ci[1],
      isUpperBound: true,
    };
  }

  // Check if we have a [value, Infinity] structure
  if (variation.ci[1] === Infinity || variation.ci[1] === null) {
    return {
      value: variation.ci[0],
      isUpperBound: false,
    };
  }

  // If both values are finite, return the one closer to zero
  const absLower = Math.abs(variation.ci[0] || 0);
  const absUpper = Math.abs(variation.ci[1] || 0);

  return absLower <= absUpper
    ? { value: variation.ci[0], isUpperBound: false }
    : { value: variation.ci[1], isUpperBound: true };
};
