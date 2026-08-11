import React, { useEffect, useMemo, useRef, useState } from "react";
import { ParentSizeModern } from "@visx/responsive";
import { scaleLinear, scaleTime } from "@visx/scale";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { Group } from "@visx/group";
import { defaultStyles, TooltipWithBounds, useTooltip } from "@visx/tooltip";
import { datetime } from "shared/dates";
import {
  type GraphPoint,
  getBucketStepMs,
  getSeriesBucketStepMs,
} from "@/components/ErrorTracking/issueTrendChartUtils";

type TooltipData = {
  range: string;
  count: number;
};

const MARGIN = { top: 20, right: 20, bottom: 40, left: 56 };
const DEFAULT_BAR_FILL = "var(--blue-9)";
const ACTIVE_BAR_FILL = "var(--violet-9)";

function getXDomain(
  data: GraphPoint[],
  zoomDomain: [number, number] | null,
  bucketStepMs: number,
): [Date, Date] {
  const xMin = zoomDomain
    ? zoomDomain[0]
    : Math.min(...data.map((point) => point.t));
  const xMax = zoomDomain
    ? zoomDomain[1]
    : Math.max(...data.map((point) => point.t));
  const domainData = zoomDomain
    ? data.filter((point) => point.t >= xMin && point.t <= xMax)
    : data;
  const series = domainData.length ? domainData : data;
  const startStepMs = series.length ? getBucketStepMs(series, 0) : bucketStepMs;
  const lastStepMs = series.length
    ? getBucketStepMs(series, series.length - 1)
    : bucketStepMs;
  const startPad = startStepMs / 2;
  const endPad = lastStepMs / 2;

  if (xMin === xMax) {
    return [new Date(xMin - startPad), new Date(xMax + lastStepMs + endPad)];
  }

  return [new Date(xMin - startPad), new Date(xMax + lastStepMs + endPad)];
}

function formatBucketRange(startMs: number, stepMs: number): string {
  const start = datetime(new Date(startMs));
  const end = datetime(new Date(startMs + stepMs));
  return start === end ? start : `${start} – ${end}`;
}

function getYAxisTickValues(yMax: number): number[] | undefined {
  const max = Math.ceil(yMax);
  if (max <= 5) {
    return Array.from({ length: max + 1 }, (_, index) => index);
  }
  return undefined;
}

export default function IssueTrendChart({
  data,
  zoomDomain,
  onZoomDomainChange,
  activeBucketStartMs = null,
  onBarClick,
  height = 240,
}: {
  data: GraphPoint[];
  zoomDomain: [number, number] | null;
  onZoomDomainChange: (domain: [number, number] | null) => void;
  activeBucketStartMs?: number | null;
  onBarClick?: (bucketStartMs: number, bucketEndMs: number) => void;
  height?: number;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [selection, setSelection] = useState<{
    startX: number;
    endX: number;
  } | null>(null);
  const {
    tooltipOpen,
    tooltipLeft,
    tooltipTop,
    tooltipData,
    hideTooltip,
    showTooltip,
  } = useTooltip<TooltipData>();

  const visibleData = useMemo(() => {
    if (!zoomDomain) return data;
    const [start, end] = zoomDomain;
    return data.filter((point) => point.t >= start && point.t <= end);
  }, [data, zoomDomain]);

  useEffect(() => {
    if (!selection) return;

    const handleMove = (event: MouseEvent) => {
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const x = Math.max(
        MARGIN.left,
        Math.min(event.clientX - rect.left, rect.width - MARGIN.right),
      );
      setSelection((current) => (current ? { ...current, endX: x } : null));
    };

    const handleUp = () => {
      const svg = svgRef.current;
      const current = selection;
      if (!svg || !current) return;

      const startX = Math.min(current.startX, current.endX);
      const endX = Math.max(current.startX, current.endX);
      setSelection(null);

      if (endX - startX < 6) {
        return;
      }

      const width = svg.clientWidth;
      const bucketStepMs = getSeriesBucketStepMs(data);
      const xScale = scaleTime({
        domain: getXDomain(data, zoomDomain, bucketStepMs),
        range: [MARGIN.left, width - MARGIN.right],
      });
      const start = xScale.invert(startX);
      const end = xScale.invert(endX);
      if (!start || !end) {
        return;
      }

      onZoomDomainChange([
        Math.min(start.getTime(), end.getTime()),
        Math.max(start.getTime(), end.getTime()),
      ]);
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [data, onZoomDomainChange, selection, zoomDomain]);

  const beginSelection = (clientX: number, plotWidth: number) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const x = Math.max(
      MARGIN.left,
      Math.min(clientX - rect.left, plotWidth - MARGIN.right),
    );
    hideTooltip();
    setSelection({ startX: x, endX: x });
  };

  const showBarTooltip = (
    event: React.MouseEvent<SVGRectElement>,
    point: GraphPoint,
    stepMs: number,
  ) => {
    const bounds = containerRef.current?.getBoundingClientRect();
    if (!bounds) return;
    showTooltip({
      tooltipLeft: event.clientX - bounds.left + 12,
      tooltipTop: event.clientY - bounds.top - 12,
      tooltipData: {
        range: formatBucketRange(point.t, stepMs),
        count: point.c,
      },
    });
  };

  if (!data.length) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      style={{ height, position: "relative" }}
      className="mb-3"
    >
      <ParentSizeModern>
        {({ width }) => {
          if (width < 10) {
            return null;
          }

          const yMax = Math.max(...visibleData.map((point) => point.c), 1);
          const bucketStepMs = getSeriesBucketStepMs(visibleData);
          const xScale = scaleTime({
            domain: getXDomain(data, zoomDomain, bucketStepMs),
            range: [MARGIN.left, width - MARGIN.right],
          });
          const yScale = scaleLinear({
            domain: [0, yMax],
            range: [height - MARGIN.bottom, MARGIN.top],
          });
          const yAxisTickValues = getYAxisTickValues(yMax);
          const plotClipId = "issue-trend-plot-clip";

          const selectionStart = selection
            ? Math.min(selection.startX, selection.endX)
            : null;
          const selectionEnd = selection
            ? Math.max(selection.startX, selection.endX)
            : null;
          const selectionStartTime =
            selectionStart != null ? xScale.invert(selectionStart) : null;
          const selectionEndTime =
            selectionEnd != null ? xScale.invert(selectionEnd) : null;

          return (
            <>
              <svg
                ref={svgRef}
                width={width}
                height={height}
                style={{ cursor: "crosshair", userSelect: "none" }}
              >
                <defs>
                  <clipPath id={plotClipId}>
                    <rect
                      x={MARGIN.left}
                      y={MARGIN.top}
                      width={width - MARGIN.left - MARGIN.right}
                      height={height - MARGIN.top - MARGIN.bottom}
                    />
                  </clipPath>
                </defs>
                <Group>
                  <AxisBottom
                    top={height - MARGIN.bottom}
                    scale={xScale}
                    numTicks={4}
                  />
                  <AxisLeft
                    left={MARGIN.left}
                    scale={yScale}
                    numTicks={yAxisTickValues ? undefined : 4}
                    tickValues={yAxisTickValues}
                    tickFormat={(value) => String(Math.round(Number(value)))}
                  />
                  <rect
                    x={MARGIN.left}
                    y={MARGIN.top}
                    width={width - MARGIN.left - MARGIN.right}
                    height={height - MARGIN.top - MARGIN.bottom}
                    fill="transparent"
                    onMouseDown={(event) =>
                      beginSelection(event.clientX, width)
                    }
                  />
                  <Group clipPath={`url(#${plotClipId})`}>
                    {visibleData.map((point, index) => {
                      const stepMs = getBucketStepMs(visibleData, index);
                      const bucketStart =
                        xScale(new Date(point.t)) ?? MARGIN.left;
                      const bucketEnd =
                        xScale(new Date(point.t + stepMs)) ?? bucketStart;
                      const bucketWidth = Math.max(bucketEnd - bucketStart, 2);
                      const barInset = Math.min(2, bucketWidth * 0.1);
                      const barWidth = Math.max(bucketWidth - barInset * 2, 1);
                      const barTop = yScale(point.c) ?? height - MARGIN.bottom;
                      const isActive =
                        activeBucketStartMs != null &&
                        point.t === activeBucketStartMs;
                      const isClickable = point.c > 0 && Boolean(onBarClick);

                      return (
                        <rect
                          key={point.t}
                          x={bucketStart + barInset}
                          y={barTop}
                          width={barWidth}
                          height={Math.max(height - MARGIN.bottom - barTop, 0)}
                          fill={isActive ? ACTIVE_BAR_FILL : DEFAULT_BAR_FILL}
                          rx={1}
                          style={{
                            cursor: isClickable ? "pointer" : undefined,
                          }}
                          onMouseEnter={(event) =>
                            showBarTooltip(event, point, stepMs)
                          }
                          onMouseMove={(event) =>
                            showBarTooltip(event, point, stepMs)
                          }
                          onMouseLeave={hideTooltip}
                          onMouseDown={(event) => {
                            event.stopPropagation();
                          }}
                          onClick={(event) => {
                            event.stopPropagation();
                            if (!isClickable || !onBarClick) return;
                            onBarClick(point.t, point.t + stepMs);
                          }}
                        />
                      );
                    })}
                  </Group>
                  {selectionStart != null && selectionEnd != null && (
                    <>
                      <rect
                        x={selectionStart}
                        y={MARGIN.top}
                        width={Math.max(selectionEnd - selectionStart, 0)}
                        height={height - MARGIN.top - MARGIN.bottom}
                        fill="var(--blue-a4)"
                        stroke="var(--blue-9)"
                        strokeWidth={1}
                        pointerEvents="none"
                      />
                      <line
                        x1={selectionStart}
                        x2={selectionStart}
                        y1={MARGIN.top}
                        y2={height - MARGIN.bottom}
                        stroke="var(--blue-9)"
                        strokeWidth={1.5}
                        pointerEvents="none"
                      />
                      <line
                        x1={selectionEnd}
                        x2={selectionEnd}
                        y1={MARGIN.top}
                        y2={height - MARGIN.bottom}
                        stroke="var(--blue-9)"
                        strokeWidth={1.5}
                        pointerEvents="none"
                      />
                      {selectionStartTime && selectionEndTime && (
                        <>
                          <text
                            x={selectionStart}
                            y={MARGIN.top - 6}
                            textAnchor="start"
                            fontSize={11}
                            fill="var(--gray-11)"
                            pointerEvents="none"
                          >
                            {datetime(selectionStartTime)}
                          </text>
                          <text
                            x={selectionEnd}
                            y={MARGIN.top - 6}
                            textAnchor="end"
                            fontSize={11}
                            fill="var(--gray-11)"
                            pointerEvents="none"
                          >
                            {datetime(selectionEndTime)}
                          </text>
                        </>
                      )}
                    </>
                  )}
                </Group>
              </svg>
              {tooltipOpen && tooltipData && (
                <TooltipWithBounds
                  top={tooltipTop}
                  left={tooltipLeft}
                  style={{
                    ...defaultStyles,
                    backgroundColor: "var(--slate-2)",
                    color: "var(--slate-12)",
                    borderRadius: 4,
                    padding: "8px 10px",
                    boxShadow: "var(--shadow-4)",
                    pointerEvents: "none",
                    zIndex: 10,
                  }}
                >
                  <div className="small text-muted">{tooltipData.range}</div>
                  <div>
                    <strong>{tooltipData.count}</strong>{" "}
                    {tooltipData.count === 1 ? "error" : "errors"}
                  </div>
                </TooltipWithBounds>
              )}
            </>
          );
        }}
      </ParentSizeModern>
    </div>
  );
}
