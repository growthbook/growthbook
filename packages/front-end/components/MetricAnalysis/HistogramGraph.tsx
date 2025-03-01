import React, { FC, useEffect, useMemo, useState } from "react";
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
import { useCurrency } from "@/hooks/useCurrency";

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
  const x = (data.length > 0 ? (index + 0.5) / data.length : 0) * innerWidth;
  const y = (yScale(datapoint.units) ?? 0) as number;
  return { x, y, d: datapoint };
}

function getTooltipContents(
  d: TooltipData,
  formatter: (value: number, options?: Intl.NumberFormatOptions) => string,
  formatterOptions?: Intl.NumberFormatOptions
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
  formatter,
  height = 220,
  margin = [15, 15, 30, 80],
}: HistogramGraphProps) => {
  const { containerRef, containerBounds } = useTooltipInPortal({
    scroll: true,
    detectBounds: true,
  });

  const displayCurrency = useCurrency();
  const formatterOptions = { currency: displayCurrency };

  const [marginTop, marginRight, marginBottom, marginLeft] = margin;

  const width = (containerBounds?.width || 0) + marginRight + marginLeft;
  const yMax = height - marginTop - marginBottom;
  const xMax = containerBounds?.width || 0;
  const binWidth = xMax / data.length;
  const numTicks = useMemo(() => {
    const maxXVal = data[data.length - 1];
    const formattedMaxVal = formatter(maxXVal.end);
    let n = Math.min(data.length + 1, 20);
    if (formattedMaxVal.length >= 8) n /= 2;
    if (width < 1200) n /= 2;
    if (width < 728) n /= 2;
    return n;
  }, [data, width, formatter]);
  const numYTicks = 5;

  const xScale = useMemo(
    () =>
      scaleLinear({
        domain: [0, data.length],
        range: [0, xMax],
      }),
    [data, xMax]
  );

  const yScale = useMemo(() => {
    const maxVal = Math.max(...data.map((d) => d.units));
    return scaleLinear({
      domain: [0, maxVal * 1.05], // extra top padding
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
      const innerWidth = width - marginLeft - marginRight;
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
                        formatterOptions
                      )}
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
                  tickStroke={"var(--text-color-table)"}
                  numTicks={numTicks}
                  tickLabelProps={() => ({
                    fill: "var(--text-color-table)",
                    fontSize: 10,
                    textAnchor: "middle",
                    dx: -10,
                  })}
                  tickFormat={(v) => {
                    const i = v as number;
                    return i < data.length
                      ? `${formatter(data[i]?.start, formatterOptions)}`
                      : `${formatter(data[i - 1]?.end, formatterOptions)}`;
                  }}
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
