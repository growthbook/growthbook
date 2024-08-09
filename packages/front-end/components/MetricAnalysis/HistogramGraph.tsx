import React, { FC, useEffect, useState } from "react";
import { ParentSizeModern } from "@visx/responsive";
import { Group } from "@visx/group";
import { scaleLinear } from "@visx/scale";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { Bar } from "@visx/shape";
import {
  TooltipWithBounds,
  useTooltip,
  useTooltipInPortal,
} from "@visx/tooltip";
import { ScaleLinear } from "d3-scale";
import styles from "@/components/Metrics/DateGraph.module.scss";

interface Datapoint {
  start: number;
  end: number;
  units: number;
}

type TooltipData = { x: number; y: number; d: Datapoint };

interface HistogramGraphProps {
  data: Datapoint[];
  formatter: (value: number, options?: Intl.NumberFormatOptions) => string;
  height?: number;
  margin?: [number, number, number, number];
}

function getTooltipDataFromDatapoint(
  datapoint: Datapoint,
  data: Datapoint[],
  innerWidth: number,
  yScale: ScaleLinear<unknown, unknown, never>
) {
  const index = data.indexOf(datapoint);
  if (index === -1) {
    return null;
  }
  const x =
    (data.length > 0 ? (index + 0.5) / (data.length + 1) : 0) * innerWidth;
  const y = (yScale(datapoint.units ?? 0) ?? 0) as number;
  return { x, y, d: datapoint };
}

function getTooltipContents(
  d: TooltipData,
  formatter: (value: number, options?: Intl.NumberFormatOptions) => string
) {
  return (
    <>
      <div className={`mb-2 ${styles.val}`}>n: {d.d.units}</div>
      <div className="small">
        <span className="d-inline-block" style={{ width: 40 }}>
          start:
        </span>{" "}
        {formatter(d.d.start)}
      </div>
      <div className="small">
        <span className="d-inline-block" style={{ width: 40 }}>
          end:
        </span>{" "}
        {formatter(d.d.end)}
      </div>
    </>
  );
}

const HistogramGraph: FC<HistogramGraphProps> = ({
  data,
  formatter,
  height = 220,
  margin = [15, 15, 30, 80],
}: HistogramGraphProps) => {
  const { containerRef, containerBounds } = useTooltipInPortal({
    scroll: true,
    detectBounds: true,
  });

  const [marginTop, marginRight, marginBottom, marginLeft] = margin;

  const width = (containerBounds?.width || 0) + marginRight + marginLeft;
  const yMax = height - marginTop - marginBottom;
  const xMax = containerBounds?.width || 0;
  const graphHeight = yMax;
  const binWidth = xMax / data.length;

  const xScale = scaleLinear({
    domain: [0, data.length],
    range: [0, xMax],
  });

  const yScale = scaleLinear({
    domain: [0, Math.max(...data.map((d) => d.units))],
    range: [yMax, 0],
  });

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

  useEffect(
    () => {
      if (hoverBin === null) {
        hideTooltip();
        return;
      }
      const datapoint = data[hoverBin];
      if (!datapoint) {
        hideTooltip();
        return;
      }
      const innerWidth =
        width - marginLeft - marginRight + width / data.length - 1;
      const tooltipData = getTooltipDataFromDatapoint(
        datapoint,
        data,
        innerWidth,
        yScale
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
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hoverBin, data, marginLeft, marginRight, width, showTooltip, hideTooltip]
  );

  return (
    <ParentSizeModern style={{ position: "relative" }}>
      {({ width }) => {
        const xMax = width - marginRight - marginLeft;

        const handlePointerMove = (
          event: React.PointerEvent<HTMLDivElement>
        ) => {
          // coordinates should be relative to the container in which Tooltip is rendered
          const containerX =
            ("clientX" in event ? event.clientX : 0) - containerBounds.left;
          const bin = Math.min(
            Math.max(0, Math.floor((data.length * containerX) / xMax)),
            data.length - 1
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
                width: xMax,
                height: graphHeight,
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
                    {tooltipData && getTooltipContents(tooltipData, formatter)}
                  </TooltipWithBounds>
                </>
              )}
            </div>
            <svg width={width} height={height}>
              <Group top={marginTop} left={marginLeft}>
                {binWidth
                  ? data.map((d, i) => (
                      <Bar
                        key={`bar-${i}`}
                        x={xScale(i)}
                        y={yScale(d.units)}
                        height={yMax - yScale(d.units)}
                        width={binWidth - 1}
                        fill={hoverBin === i ? "#aaaaff" : "#8884d8"}
                        style={{ transition: "150ms all" }}
                      />
                    ))
                  : null}
                <AxisBottom
                  top={yMax}
                  scale={xScale}
                  stroke={"var(--text-color-table)"}
                  tickStroke="#333"
                  tickLabelProps={() => ({
                    fill: "var(--text-color-table)",
                    fontSize: 10,
                    textAnchor: "middle",
                  })}
                  numTicks={data.length + 1}
                  tickFormat={(v) => {
                    const i = v as number;
                    return i < data.length
                      ? `${formatter(data[i]?.start)}`
                      : `${formatter(data[i - 1]?.end)}`;
                  }}
                />
                <AxisLeft
                  scale={yScale}
                  stroke={"var(--text-color-table)"}
                  tickStroke={"var(--text-color-table)"}
                  tickLabelProps={() => ({
                    fill: "var(--text-color-table)",
                    fontSize: 12,
                    textAnchor: "end",
                    dx: -10,
                  })}
                  label="Count"
                  labelClassName="h5"
                  labelOffset={55}
                />
              </Group>
            </svg>
          </>
        );
      }}
    </ParentSizeModern>
  );
};

export default HistogramGraph;
