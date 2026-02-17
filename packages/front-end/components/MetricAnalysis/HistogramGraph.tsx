import React, { FC, useCallback, useEffect, useMemo, useState } from "react";
import { ParentSize } from "@visx/responsive";
import { Group } from "@visx/group";
import { scaleLinear } from "@visx/scale";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { BarRounded } from "@visx/shape";
import {
  TooltipWithBounds,
  useTooltip,
  useTooltipInPortal,
} from "@visx/tooltip";
import { ScaleLinear } from "d3-scale";
import styles from "@/components/Metrics/DateGraph.module.scss";
import { useCurrency } from "@/hooks/useCurrency";

interface Datapoint {
  start: number;
  end: number;
  units: number;
}

type TooltipData = { x: number; y: number; d: Datapoint };

interface HistogramGraphProps {
  data: Datapoint[];
  xAxisLabel?: string;
  mean?: number;
  formatter: (value: number, options?: Intl.NumberFormatOptions) => string;
  height?: number;
  margin?: [number, number, number, number];
  highlightPositiveNegative?: boolean;
  invertHighlightColors?: boolean;
}

function getTooltipDataFromDatapoint(
  datapoint: Datapoint,
  data: Datapoint[],
  innerWidth: number,
  yScale: ScaleLinear<unknown, unknown, never>,
) {
  const index = data.indexOf(datapoint);
  if (index === -1) {
    return null;
  }
  const x = (data.length > 0 ? (index + 0.5) / data.length : 0) * innerWidth;
  const y = (yScale(datapoint.units) ?? 0) as number;
  return { x, y, d: datapoint };
}

function getTooltipContents(
  d: TooltipData,
  formatter: (value: number, options?: Intl.NumberFormatOptions) => string,
  formatterOptions?: Intl.NumberFormatOptions,
) {
  return (
    <>
      <div className={`mb-2 ${styles.val}`}>n: {d.d.units}</div>
      <div className="small">
        <span className="d-inline-block" style={{ width: 40 }}>
          start:
        </span>{" "}
        {formatter(d.d.start, formatterOptions)}
      </div>
      <div className="small">
        <span className="d-inline-block" style={{ width: 40 }}>
          end:
        </span>{" "}
        {formatter(d.d.end, formatterOptions)}
      </div>
    </>
  );
}

const HistogramGraph: FC<HistogramGraphProps> = ({
  data,
  mean,
  formatter,
  xAxisLabel,
  height = 220,
  margin = [15, 15, 30, 80],
  highlightPositiveNegative = false,
  invertHighlightColors = false,
}: HistogramGraphProps) => {
  const { containerRef, containerBounds } = useTooltipInPortal({
    scroll: true,
    detectBounds: true,
  });

  const displayCurrency = useCurrency();
  const formatterOptions = { currency: displayCurrency };

  const [marginTop, marginRight, marginBottom, marginLeft] = margin;

  const outerWidth = (containerBounds?.width || 0) + marginRight + marginLeft;
  const yMax = height - marginTop - marginBottom;
  const xMaxResponsive = containerBounds?.width || 0; // xMax for responsive calculations based on containerBounds

  const binWidth = data.length > 0 ? xMaxResponsive / data.length : 0;

  const numYTicks = 5;

  const valueDomain = useMemo(() => {
    if (!data || data.length === 0) return { min: 0, max: 0, defined: false };
    const allBinStarts = data.map((d) => d.start);
    const allBinEnds = data.map((d) => d.end);
    const minVal = Math.min(...allBinStarts);
    const maxVal = Math.max(...allBinEnds);
    if (
      typeof minVal !== "number" ||
      typeof maxVal !== "number" ||
      Number.isNaN(minVal) ||
      Number.isNaN(maxVal)
    ) {
      return { min: 0, max: 0, defined: false };
    }

    // Calculate domain padding (about 1% of the domain range on each side)
    const domainRange = maxVal - minVal;
    const padding = domainRange * 0.01;

    return {
      min: minVal - padding,
      max: maxVal + padding,
      defined: true,
    };
  }, [data]);

  const yScale = useMemo(() => {
    const units = data.map((d) => d.units);
    const maxVal = units.length > 0 ? Math.max(...units) : 0;
    return scaleLinear({
      domain: [0, maxVal * 1.05 || 1], // extra top padding, default max 1 if maxVal is 0
      range: [yMax, 0],
    });
  }, [data, yMax]);

  const {
    showTooltip,
    hideTooltip,
    tooltipOpen,
    tooltipData,
    tooltipLeft = 0,
    tooltipTop = 0,
  } = useTooltip<TooltipData>();

  const [hoverBin, setHoverBin] = useState<number | null>(null);
  const onHover = (bin: number | null) => {
    setHoverBin(bin);
  };

  useEffect(() => {
    if (hoverBin === null || !data || data.length === 0) {
      hideTooltip();
      return;
    }
    const datapoint = data[hoverBin];
    if (!datapoint) {
      hideTooltip();
      return;
    }
    const innerWidth = outerWidth - marginLeft - marginRight;
    const tooltipData = getTooltipDataFromDatapoint(
      datapoint,
      data,
      innerWidth,
      yScale,
    );
    if (!tooltipData) {
      hideTooltip();
      return;
    }

    showTooltip({
      tooltipLeft: tooltipData.x,
      tooltipTop: tooltipData.y,
      tooltipData: tooltipData,
    });
  }, [
    hoverBin,
    data,
    marginLeft,
    marginRight,
    outerWidth,
    showTooltip,
    hideTooltip,
    yScale,
  ]);

  const getContentXScale = useCallback(
    (currentXMax: number) => {
      if (!valueDomain.defined) {
        return scaleLinear({ domain: [0, 1], range: [0, currentXMax] }); // Fallback
      }
      return scaleLinear({
        domain: [valueDomain.min, valueDomain.max],
        range: [0, currentXMax],
      });
    },
    [valueDomain],
  );

  const getGeneratedTickValues = useCallback(
    (contentXScale: ScaleLinear<number, number, never>) => {
      if (!valueDomain.defined) {
        return [];
      }
      if (valueDomain.min === valueDomain.max) {
        return [valueDomain.min];
      }

      const ticks = contentXScale.ticks(10); // Aim for ~10 ticks

      // Ensure 0 is included if it's within the domain and not already present
      if (valueDomain.min <= 0 && valueDomain.max >= 0 && !ticks.includes(0)) {
        ticks.push(0);
        ticks.sort((a, b) => a - b);
      }

      // Cap the number of ticks to avoid overcrowding, e.g., max 20.
      // d3.ticks(10) usually gives less than 20, but adding 0 might increase it.
      if (ticks.length > 20) {
        // This is a simple way to reduce; more sophisticated methods exist if needed.
        // For now, let's assume .ticks() and adding 0 won't lead to extreme excess.
        // If it does, one might filter/resample `ticks` here.
      }

      return ticks;
    },
    [valueDomain],
  );

  return (
    <ParentSize style={{ position: "relative" }}>
      {({ width: parentWidth }) => {
        // parentWidth is the width from ParentSize
        const currentXMax = parentWidth - marginRight - marginLeft; // This is the actual drawable xMax

        const contentXScale = getContentXScale(currentXMax);

        const generatedTickValues = getGeneratedTickValues(contentXScale);

        const handlePointerMove = (
          event: React.PointerEvent<HTMLDivElement>,
        ) => {
          if (!data || data.length === 0) {
            onHover(null);
            return;
          }
          // coordinates should be relative to the container in which Tooltip is rendered
          const containerX =
            ("clientX" in event ? event.clientX : 0) - containerBounds.left;
          const bin = Math.min(
            Math.max(0, Math.floor((data.length * containerX) / currentXMax)),
            data.length - 1,
          );
          onHover(bin);
        };

        const handlePointerLeave = () => {
          hideTooltip();
          onHover(null);
        };

        return (
          <>
            <div
              ref={containerRef}
              style={{
                zIndex: 1,
                position: "absolute",
                overflow: "hidden",
                width: currentXMax,
                height: yMax,
                marginLeft: marginLeft,
                marginTop: marginTop,
              }}
              onPointerMove={handlePointerMove}
              onPointerLeave={handlePointerLeave}
            >
              {tooltipOpen && (
                <>
                  <div
                    className={styles.positionIndicator}
                    style={{
                      transform: `translate(${tooltipLeft}px, ${tooltipTop}px)`,
                    }}
                  />
                  <TooltipWithBounds
                    left={tooltipLeft}
                    top={tooltipTop}
                    className={styles.tooltip}
                    unstyled={true}
                  >
                    {tooltipData &&
                      getTooltipContents(
                        tooltipData,
                        formatter,
                        formatterOptions,
                      )}
                  </TooltipWithBounds>
                </>
              )}
            </div>
            <svg
              width={parentWidth}
              height={height + 20} // Add some extra height for the axis labels
            >
              <Group top={marginTop} left={marginLeft}>
                {binWidth > 0 && data.length > 0
                  ? data.map((d, i) => {
                      const defaultBarColor = "#8884d8";
                      const hoverBarColor = "#aaaaff";
                      let fill = defaultBarColor;

                      if (highlightPositiveNegative) {
                        // d is from processedData, so it won't cross zero.
                        // A bin is positive if its start is >= 0.
                        // If start is < 0, then end must be 0 (or < 0 if original was fully negative).
                        const isPositive = d.start >= 0;
                        const positiveColor = invertHighlightColors
                          ? "var(--red-11)"
                          : "var(--jade-11)";
                        const negativeColor = invertHighlightColors
                          ? "var(--jade-11)"
                          : "var(--red-11)";

                        fill = isPositive ? positiveColor : negativeColor;
                      }

                      if (hoverBin === i) {
                        fill = hoverBarColor;
                      }

                      // Use contentXScale for positioning the bars (with equal distribution)
                      const barX = contentXScale(d.start);
                      const barWidth =
                        contentXScale(d.end) - contentXScale(d.start);
                      const barY = yScale(d.units);
                      const barHeight = yMax - barY;

                      return (
                        <BarRounded
                          key={`bar-${i}-${d.start}-${d.end}`}
                          x={barX}
                          y={barY}
                          height={barHeight >= 0 ? barHeight : 0} // Ensure non-negative height
                          width={barWidth > 1 ? barWidth - 0.5 : barWidth} // Small gap if possible
                          fill={fill}
                          style={{ transition: "150ms all" }}
                          radius={6}
                          top={true}
                          bottom={false}
                        />
                      );
                    })
                  : null}
                <AxisBottom
                  top={yMax}
                  scale={contentXScale}
                  stroke={"var(--text-color-table)"}
                  tickStroke={"var(--text-color-table)"}
                  tickValues={generatedTickValues}
                  tickLabelProps={() => ({
                    fill: "var(--text-color-table)",
                    fontSize: 10,
                    textAnchor: "middle",
                  })}
                  label={xAxisLabel}
                  labelClassName="h5"
                  labelOffset={25}
                  labelProps={{
                    style: { fill: "var(--slate-11)" },
                  }}
                  tickFormat={(value) =>
                    formatter(value as number, formatterOptions)
                  }
                />
                <AxisLeft
                  scale={yScale}
                  stroke={"var(--text-color-table)"}
                  tickStroke={"var(--text-color-table)"}
                  numTicks={numYTicks}
                  tickLabelProps={() => ({
                    fill: "var(--text-color-table)",
                    fontSize: 12,
                    textAnchor: "end",
                    dx: -5,
                  })}
                  label="Count"
                  labelProps={{
                    style: { fill: "var(--slate-11)", translate: "0 15px" },
                  }}
                  labelClassName="h5"
                  labelOffset={55}
                />
                <line
                  x1={contentXScale(0)}
                  y1={marginTop - 10}
                  x2={contentXScale(0)}
                  y2={height - marginBottom - marginTop}
                  stroke="var(--color-text-low)"
                  strokeWidth={2}
                />
                {mean !== undefined && (
                  <line
                    x1={contentXScale(mean)}
                    y1={marginTop - 10}
                    x2={contentXScale(mean)}
                    y2={height - marginBottom - marginTop + 10}
                    stroke="var(--blue-11)"
                    strokeWidth={1}
                    strokeDasharray="4, 4"
                  />
                )}
              </Group>
            </svg>
          </>
        );
      }}
    </ParentSize>
  );
};

export default HistogramGraph;
