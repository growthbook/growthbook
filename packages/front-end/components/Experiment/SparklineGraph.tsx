import React, { useRef } from "react";
import { Group } from "@visx/group";
import { LinePath, AreaClosed, Line } from "@visx/shape";
import { scaleTime, scaleLinear } from "@visx/scale";
import { extent, bisector } from "d3-array";
import { localPoint } from "@visx/event";
import { curveMonotoneX } from "@visx/curve";
import { useSpring, animated } from "@react-spring/web";
import {
  withTooltip,
  useTooltipInPortal,
  defaultStyles as tooltipStyles,
} from "@visx/tooltip";
import { WithTooltipProvidedProps } from "@visx/tooltip/lib/enhancers/withTooltip";
import { timeFormat } from "d3-time-format";
import { Flex } from "@radix-ui/themes";
import { MetricTimeSeries } from "back-end/src/validators/metric-time-series";
import { ExperimentMetricInterface } from "shared/experiments";
import useApi from "@/hooks/useApi";
import { getExperimentMetricFormatter } from "@/services/metrics";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useCurrency } from "@/hooks/useCurrency";
import { getVariationColor } from "@/services/features";

interface SparklineGraphProps {
  width?: number;
  height?: number;
  margin?: { top: number; right: number; bottom: number; left: number };
  id: string;
  metric: ExperimentMetricInterface;
}

interface DataPoint {
  date: Date;
  variations: {
    value: number;
    users?: number;
    name: string;
  }[];
}

const getDate = (d: DataPoint) => d.date;
const getValue = (d: DataPoint, variationIndex: number) =>
  d.variations[variationIndex]?.value ?? 0;
const bisectDate = bisector<DataPoint, Date>((d) => new Date(d.date)).left;

function Message({ children }: { children: React.ReactNode }) {
  return (
    <Flex
      align="center"
      height="100%"
      justify="center"
      position="relative"
      width="100%"
    >
      {children}
    </Flex>
  );
}

const SparklineGraphBase: React.FC<
  SparklineGraphProps & WithTooltipProvidedProps<DataPoint>
> = ({
  width = 100,
  height = 30,
  margin = { top: 2, right: 2, bottom: 2, left: 2 },
  id,
  metric,
  showTooltip,
  hideTooltip,
  tooltipData,
  tooltipTop,
  tooltipLeft,
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const { containerRef, TooltipInPortal } = useTooltipInPortal({
    detectBounds: true,
    scroll: true,
  });
  const { getFactTableById } = useDefinitions();
  const displayCurrency = useCurrency();
  const formatterOptions = { currency: displayCurrency };

  // Animation spring - moved before conditional returns
  const springProps = useSpring({
    from: { opacity: 0 },
    to: { opacity: 1 },
    config: { tension: 280, friction: 20 },
  });

  const { data, isLoading, error } = useApi<{ timeSeries: MetricTimeSeries[] }>(
    `/safe-rollout/${id}/time-series?metricIds[]=${metric.id}`
  );

  // Create empty graph data for initial render
  const emptyGraphData: DataPoint[] = [];
  const graphData =
    data?.timeSeries[0]?.dataPoints.map((point) => ({
      date: new Date(point.date),
      variations: point.variations.map((v) => ({
        value: v.stats?.mean ?? 0,
        users: v.stats?.users,
        name: v.name,
      })),
    })) ?? emptyGraphData;

  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  const xScale = scaleTime<number>({
    domain: extent(graphData, getDate) as [Date, Date],
    range: [0, innerWidth],
  });

  // Calculate y scale based on all variations
  const allValues = graphData.flatMap((d) => d.variations.map((v) => v.value));
  const yExtent = extent(allValues) as [number, number];
  const yMin = Math.min(0, yExtent[0]);
  const yMax = Math.max(0, yExtent[1]);
  const yScale = scaleLinear<number>({
    domain: [yMin, yMax],
    range: [innerHeight, 0],
  });

  // Tooltip handler - moved before conditional returns
  const handleTooltip = React.useCallback(
    (
      event: React.TouchEvent<SVGRectElement> | React.MouseEvent<SVGRectElement>
    ) => {
      if (!graphData.length) return;

      const { x } = localPoint(event) || { x: 0 };
      const x0 = xScale.invert(x - margin.left);
      const index = bisectDate(graphData, x0, 1);
      const d0 = graphData[index - 1];
      const d1 = graphData[index];
      let d = d0;
      if (d1 && getDate(d1)) {
        d =
          x0.valueOf() - getDate(d0).valueOf() >
          getDate(d1).valueOf() - x0.valueOf()
            ? d1
            : d0;
      }
      if (showTooltip) {
        showTooltip({
          tooltipData: d,
          tooltipLeft: xScale(getDate(d)) + margin.left,
          tooltipTop:
            yScale(Math.max(...d.variations.map((v) => v.value))) + margin.top,
        });
      }
    },
    [showTooltip, xScale, yScale, margin.left, margin.top, graphData]
  );

  if (error) {
    return <Message>Error loading data</Message>;
  }

  if (isLoading) {
    return <Message>Loading...</Message>;
  }

  if (!data || data.timeSeries.length === 0) {
    return <Message>No data available</Message>;
  }

  const metricValueFormatter = getExperimentMetricFormatter(
    metric,
    getFactTableById
  );

  // Calculate the y position for the zero line
  const zeroY = yScale(0);

  return (
    <div ref={containerRef}>
      <svg ref={svgRef} width={width} height={height}>
        <defs>
          {graphData[0]?.variations.map((_, i) => (
            <linearGradient
              key={i}
              id={`area-gradient-${i}`}
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop
                offset="0%"
                stopColor={getVariationColor(i, true)}
                stopOpacity={0.2}
              />
              <stop
                offset="100%"
                stopColor={getVariationColor(i, true)}
                stopOpacity={0}
              />
            </linearGradient>
          ))}
        </defs>
        <Group left={margin.left} top={margin.top}>
          {/* Zero line */}
          {zeroY >= 0 && zeroY <= innerHeight && (
            <Line
              from={{ x: 0, y: zeroY }}
              to={{ x: innerWidth, y: zeroY }}
              stroke="#3B82F6"
              strokeWidth={2}
              strokeDasharray="6,4"
              strokeOpacity={1}
            />
          )}
          {/* Gradient areas and lines for each variation */}
          {graphData[0]?.variations.map((_, variationIndex) => (
            <React.Fragment key={variationIndex}>
              {/* Gradient area below the line */}
              <AreaClosed<DataPoint>
                data={graphData}
                x={(d) => xScale(getDate(d)) ?? 0}
                y={(d) => yScale(getValue(d, variationIndex)) ?? 0}
                yScale={yScale}
                curve={curveMonotoneX}
                fill={`url(#area-gradient-${variationIndex})`}
              />
              {/* Animated line */}
              <animated.g style={{ opacity: springProps.opacity }}>
                <LinePath<DataPoint>
                  data={graphData}
                  x={(d) => xScale(getDate(d)) ?? 0}
                  y={(d) => yScale(getValue(d, variationIndex)) ?? 0}
                  curve={curveMonotoneX}
                  stroke={getVariationColor(variationIndex, true)}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </animated.g>
            </React.Fragment>
          ))}
          {/* Transparent rectangle for tooltip trigger */}
          <rect
            x={0}
            y={0}
            width={innerWidth}
            height={innerHeight}
            fill="transparent"
            onTouchStart={handleTooltip}
            onTouchMove={handleTooltip}
            onMouseMove={handleTooltip}
            onMouseLeave={() => hideTooltip && hideTooltip()}
          />
          {tooltipData && (
            <g>
              {tooltipData.variations.map((variation, i) => (
                <circle
                  key={i}
                  cx={xScale(getDate(tooltipData))}
                  cy={yScale(variation.value)}
                  r={4}
                  fill={getVariationColor(i, true)}
                  fillOpacity={0.8}
                  stroke="#fff"
                  strokeWidth={2}
                  pointerEvents="none"
                />
              ))}
            </g>
          )}
        </Group>
      </svg>
      {tooltipData && (
        <TooltipInPortal
          key={Math.random()}
          top={tooltipTop}
          left={tooltipLeft}
          style={{
            ...tooltipStyles,
            background: "white",
            border: "1px solid #e2e8f0",
            borderRadius: "4px",
            padding: "8px 12px",
            boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
          }}
        >
          <div style={{ fontSize: "12px", color: "#64748b" }}>
            <strong style={{ color: "#1e293b" }}>Date:</strong>{" "}
            {timeFormat("%x")(getDate(tooltipData))}
          </div>
          {tooltipData.variations.map((variation, i) => (
            <div key={i} style={{ fontSize: "12px", color: "#64748b" }}>
              <strong style={{ color: getVariationColor(i, true) }}>
                {variation.name}:
              </strong>{" "}
              {metricValueFormatter(variation.value, formatterOptions)}
              {variation.users !== undefined && (
                <span style={{ marginLeft: "8px" }}>
                  ({variation.users.toLocaleString()} users)
                </span>
              )}
            </div>
          ))}
        </TooltipInPortal>
      )}
    </div>
  );
};

export default withTooltip<SparklineGraphProps, DataPoint>(SparklineGraphBase);
