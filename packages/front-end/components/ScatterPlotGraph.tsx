import React from "react";
import { AxisLeft, AxisBottom } from "@visx/axis";
import { GridRows, GridColumns } from "@visx/grid";
import { Group } from "@visx/group";
import { scaleLinear, scaleLog } from "@visx/scale";
import { Line } from "@visx/shape";
import {
  useTooltip,
  TooltipWithBounds,
  defaultStyles as tooltipDefaultStyles,
} from "@visx/tooltip";
import { GlyphCircle } from "@visx/glyph";
import styles from "@/components/GraphStyles.module.scss";

export interface ScatterPointData<T> {
  y: number;
  x: number;
  // TODO make these optional to hide error bars
  ymin: number;
  ymax: number;
  xmin: number;
  xmax: number;
  units: number;
  otherData: T;
  id: string; // For unique key, e.g., index or a unique identifier from data source
}

export interface ScatterPlotGraphProps<T> {
  data: ScatterPointData<T>[];
  width: number;
  height: number;
  margin?: { top: number; right: number; bottom: number; left: number };
  xFormatter?: (value: number) => string;
  yFormatter?: (value: number) => string;
  xLabel?: string;
  yLabel?: string;
  generateTooltipContent?: (data: ScatterPointData<T>) => React.ReactNode;
}

const defaultMargin = { top: 40, right: 50, bottom: 50, left: 60 };

const ScatterPlotGraph = <T,>({
  data,
  width,
  height,
  margin = defaultMargin,
  xFormatter,
  yFormatter,
  yLabel,
  xLabel,
  generateTooltipContent,
}: ScatterPlotGraphProps<T>) => {
  const {
    tooltipData,
    tooltipLeft,
    tooltipTop,
    tooltipOpen,
    showTooltip,
    hideTooltip,
  } = useTooltip<ScatterPointData<T>>();

  if (width < 10 || height < 10 || data.length === 0) return null;

  // TODO word wrap

  // Inner dimensions
  const xMax = width - margin.left - margin.right;
  const yMax = height - margin.top - margin.bottom;

  // Scales
  const allXValues = data.flatMap((d) => [d.x, d.xmin, d.xmax]);
  const allYValues = data.flatMap((d) => [d.y, d.ymin, d.ymax]);
  const allUnits = data.map((d) => d.units).filter((u) => isFinite(u));

  const xScale = scaleLinear<number>({
    domain: [Math.min(...allXValues), Math.max(...allXValues)],
    range: [0, xMax],
    nice: true,
  });

  const yScale = scaleLinear<number>({
    domain: [Math.min(...allYValues), Math.max(...allYValues)],
    range: [yMax, 0],
    nice: true,
  });

  const sizeScale = scaleLog<number>({
    domain:
      allUnits.length > 0
        ? [Math.min(...allUnits), Math.max(...allUnits)]
        : [0, 1], // Handle empty or single-value units
    range: [5, 15], // Min and max radius for points
  });

  // Accessors
  const getX = (d: ScatterPointData<T>) => d.x;
  const getY = (d: ScatterPointData<T>) => d.y;

  return (
    <div style={{ position: "relative" }}>
      <svg width={width} height={height} style={{ overflow: "visible" }}>
        <rect
          x={0}
          y={0}
          width={width}
          height={height}
          fill="transparent"
          rx={14}
        />
        <Group left={margin.left} top={margin.top}>
          <GridRows
            scale={yScale}
            width={xMax}
            height={yMax}
            stroke="var(--slate-a5)"
            strokeDasharray="2,2"
            strokeWidth={1}
          />
          <GridColumns
            scale={xScale}
            width={xMax}
            height={yMax}
            stroke="var(--slate-a5)"
            strokeDasharray="2,2"
            strokeWidth={1}
          />

          {/* Zero line for Y-axis (horizontal) */}
          {yScale.domain()[0] <= 0 && yScale.domain()[1] >= 0 && (
            <Line
              from={{ x: 0, y: yScale(0) }}
              to={{ x: xMax, y: yScale(0) }}
              stroke="var(--slate-11)"
              strokeWidth={1.5}
            />
          )}

          {/* Zero line for X-axis (vertical) */}
          {xScale.domain()[0] <= 0 && xScale.domain()[1] >= 0 && (
            <Line
              from={{ x: xScale(0), y: 0 }}
              to={{ x: xScale(0), y: yMax }}
              stroke="var(--slate-11)" // Darker than grid lines
              strokeWidth={1.5}
            />
          )}

          <AxisLeft
            scale={yScale}
            label={yLabel || "Y Value"}
            labelClassName={styles.label}
            labelOffset={50}
            tickFormat={yFormatter}
            tickLabelProps={() => ({
              fill: "var(--text-color-table)",
              fontSize: 14,
              textAnchor: "end",
              verticalAnchor: "middle",
            })}
          />
          <AxisBottom
            scale={xScale}
            top={yMax}
            label={xLabel || "X Value"}
            labelClassName={styles.label}
            labelOffset={20}
            tickFormat={xFormatter}
            tickLabelProps={() => ({
              fill: "var(--text-color-table)",
              fontSize: 14,
              textAnchor: "middle",
            })}
          />

          {data.map((point) => {
            const cx = xScale(getX(point));
            const cy = yScale(getY(point));
            // Ensure units is a valid number for sizeScale
            const pointUnits = isFinite(point.units) ? point.units : 0;
            const radius = sizeScale(pointUnits);

            // Error bars coordinates
            const xMinCoord = xScale(point.xmin);
            const xMaxCoord = xScale(point.xmax);
            const yMinCoord = yScale(point.ymin);
            const yMaxCoord = yScale(point.ymax);

            return (
              <React.Fragment key={`point-group-${point.id}`}>
                {/* X Error Bar */}
                <Line
                  from={{ x: xMinCoord, y: cy }}
                  to={{ x: xMaxCoord, y: cy }}
                  stroke="var(--violet-10)"
                  strokeWidth={1.5}
                  strokeOpacity={0.75}
                />
                {/* Y Error Bar */}
                <Line
                  from={{ x: cx, y: yMinCoord }}
                  to={{ x: cx, y: yMaxCoord }}
                  stroke="var(--violet-10)"
                  strokeWidth={1.5}
                  strokeOpacity={0.75}
                />
                <GlyphCircle
                  left={cx}
                  top={cy}
                  size={radius * radius * Math.PI} // GlyphCircle size is area
                  fill="var(--violet-10)" // A common blue color
                  fillOpacity={0.75}
                  stroke="#fff" // White border for better visibility
                  strokeWidth={1}
                  strokeOpacity={0.75}
                  onPointerMove={(_) => {
                    showTooltip({
                      tooltipData: point,
                      tooltipLeft: cx, // Use cx (relative to Group)
                      tooltipTop: cy, // Use cy (relative to Group)
                    });
                  }}
                  onPointerLeave={hideTooltip}
                  style={{ cursor: "pointer" }}
                />
              </React.Fragment>
            );
          })}
        </Group>
      </svg>
      {generateTooltipContent &&
        tooltipOpen &&
        tooltipData &&
        tooltipLeft != null &&
        tooltipTop != null && (
          <TooltipWithBounds
            // key={Math.random()} // Removed, usually not needed if props change correctly
            top={tooltipTop + margin.top} // Add margin.top for correct positioning relative to the outer div
            left={tooltipLeft + margin.left} // Add margin.left for correct positioning relative to the outer div
            style={{
              ...tooltipDefaultStyles,
              backgroundColor: "rgba(50,50,50,0.9)",
              color: "white",
              padding: "10px",
              borderRadius: "5px",
              fontSize: "13px",
              lineHeight: "1.5",
              boxShadow: "0px 2px 10px rgba(0,0,0,0.2)",
              pointerEvents: "none",
            }}
          >
            {generateTooltipContent(tooltipData)}
          </TooltipWithBounds>
        )}
    </div>
  );
};

export default ScatterPlotGraph;
