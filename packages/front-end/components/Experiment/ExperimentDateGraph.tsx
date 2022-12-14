import { FC, Fragment, useMemo } from "react";
import { ParentSizeModern } from "@visx/responsive";
import { Group } from "@visx/group";
import { GridColumns, GridRows } from "@visx/grid";
import { scaleLinear, scaleTime } from "@visx/scale";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { AreaClosed, LinePath } from "@visx/shape";
import { curveMonotoneX } from "@visx/curve";
import {
  TooltipWithBounds,
  useTooltip,
  useTooltipInPortal,
} from "@visx/tooltip";
import { ScaleLinear } from "d3-scale";
import { date } from "@/services/dates";
import styles from "./ExperimentDateGraph.module.scss";
export interface ExperimentDateGraphDataPoint {
  d: Date;
  variations: {
    label: string;
    value: number;
    error?: [number, number];
  }[];
}
export interface ExperimentDateGraphProps {
  variationNames: string[];
  label: string;
  datapoints: ExperimentDateGraphDataPoint[];
  tickFormat: (v: number) => string;
}

const COLORS = ["var(--text-color-primary)", "#039dd1", "#fd7e14", "#e83e8c"];

type TooltipData = { x: number; y: number[]; d: ExperimentDateGraphDataPoint };

const height = 220;
const margin = [15, 15, 30, 80];

// Render the contents of a tooltip
const getTooltipContents = (
  d: ExperimentDateGraphDataPoint,
  variationNames: string[]
) => {
  return (
    <>
      {variationNames.map((v, i) => {
        return (
          <div key={i} style={{ color: COLORS[i % COLORS.length] }}>
            {v}: <span className={styles.val}>{d.variations[i]?.label}</span>
          </div>
        );
      })}
      <div className={styles.date}>{date(d.d as Date)}</div>
    </>
  );
};

// Finds the closest date to the cursor and figures out x/y coordinates
const getTooltipData = (
  mx: number,
  width: number,
  datapoints: ExperimentDateGraphDataPoint[],
  yScale: ScaleLinear<number, number, never>,
  xScale
): TooltipData => {
  const innerWidth =
    width - margin[1] - margin[3] + width / datapoints.length - 1;
  const px = mx / innerWidth;
  const index = Math.max(
    Math.min(Math.round(px * datapoints.length), datapoints.length - 1),
    0
  );
  const d = datapoints[index];
  const x = xScale(d.d);
  const y = d.variations.map((v) => yScale(v.value) ?? 0);
  return { x, y, d };
};

const ExperimentDateGraph: FC<ExperimentDateGraphProps> = ({
  datapoints,
  variationNames,
  label,
  tickFormat,
}) => {
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

  // Get y-axis domain
  const yDomain = useMemo<[number, number]>(() => {
    const minValue = Math.min(
      ...datapoints.map((d) => Math.min(...d.variations.map((v) => v.value)))
    );
    const maxValue = Math.max(
      ...datapoints.map((d) => Math.max(...d.variations.map((v) => v.value)))
    );
    const minError = Math.min(
      ...datapoints.map((d) =>
        Math.min(
          ...d.variations.map((v) => (v.error?.[0] ? v.error[0] : v.value))
        )
      )
    );
    const maxError = Math.max(
      ...datapoints.map((d) =>
        Math.max(
          ...d.variations.map((v) => (v.error?.[1] ? v.error[1] : v.value))
        )
      )
    );

    // The error bars can be huge sometimes, so limit the domain to at most twice the min/max value
    return [
      Math.max(minError, minValue > 0 ? minValue / 2 : minValue * 2),
      Math.min(maxError, maxValue > 0 ? maxValue * 2 : maxValue / 2),
    ];
  }, [datapoints]);

  // Get x-axis domain
  const min = Math.min(...datapoints.map((d) => d.d.getTime()));
  const max = Math.max(...datapoints.map((d) => d.d.getTime()));

  return (
    <ParentSizeModern>
      {({ width }) => {
        const yMax = height - margin[0] - margin[2];
        const xMax = width - margin[1] - margin[3];
        const numXTicks =
          datapoints.length < 7 ? datapoints.length : width > 768 ? 7 : 4;
        const numYTicks = 5;
        // we want specific dates where possible.
        const allXTicks = datapoints.map((p) => p.d.getTime());
        let specificXTicks = allXTicks;
        if (allXTicks.length > numXTicks + 2) {
          // the 2 above is to add some padding - as if we are dealing with low numbers,
          // the logic below will half the number of ticks. (ie, if its 7, we would show 3 ticks, so show all 7 instead)
          // we have too many ticks, only display some of them
          let div = Math.round(specificXTicks.length / numXTicks);
          if (div === 1) div = 2;
          specificXTicks = specificXTicks.filter((x, i) => {
            return i % div === 0;
          });
        }

        const xScale = scaleTime({
          domain: [min, max],
          range: [0, xMax],
          round: true,
        });
        const yScale = scaleLinear<number>({
          domain: yDomain,
          range: [yMax, 0],
          round: true,
        });

        const handlePointer = (event: React.PointerEvent<HTMLDivElement>) => {
          // coordinates should be relative to the container in which Tooltip is rendered
          const containerX =
            ("clientX" in event ? event.clientX : 0) - containerBounds.left;
          const data = getTooltipData(
            containerX,
            width,
            datapoints,
            yScale,
            xScale
          );
          showTooltip({
            tooltipLeft: data.x,
            tooltipTop: Math.min(...data.y),
            tooltipData: data,
          });
        };

        return (
          <>
            <div className="d-flex">
              {variationNames.map((v, i) => {
                return (
                  <div
                    key={i}
                    className="mx-2"
                    style={{ color: COLORS[i % COLORS.length] }}
                  >
                    <strong>&mdash;</strong> {v}
                  </div>
                );
              })}
            </div>
            <div
              ref={containerRef}
              className={styles.tooltipDategraph}
              style={{
                width: width - margin[1] - margin[3],
                height: height - margin[0] - margin[2],
                marginLeft: margin[3],
                marginTop: margin[0],
              }}
              onPointerMove={handlePointer}
              onPointerLeave={hideTooltip}
            >
              {tooltipOpen && (
                <>
                  {variationNames.map((v, i) => {
                    // Render a dot at the current x location for each variation
                    return (
                      <div
                        key={i}
                        className={styles.positionIndicator}
                        style={{
                          transform: `translate(${tooltipLeft}px, ${tooltipData.y[i]}px)`,
                          background: COLORS[i % COLORS.length],
                        }}
                      />
                    );
                  })}
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
                    {getTooltipContents(tooltipData.d, variationNames)}
                  </TooltipWithBounds>
                </>
              )}
            </div>
            <svg width={width} height={height}>
              <Group left={margin[3]} top={margin[0]}>
                <GridRows
                  scale={yScale}
                  width={xMax}
                  numTicks={numYTicks}
                  stroke="var(--border-color-200)"
                />
                <GridColumns
                  scale={xScale}
                  stroke="var(--border-color-200)"
                  height={yMax}
                  numTicks={numXTicks}
                  tickValues={allXTicks}
                />

                {variationNames.map((v, i) => {
                  // Render a shaded area for error bars for each variation if defined
                  return typeof datapoints[0]?.variations?.[i]?.error !==
                    "undefined" ? (
                    <AreaClosed
                      key={i}
                      yScale={yScale}
                      data={datapoints}
                      x={(d) => xScale(d.d) ?? 0}
                      y0={(d) => yScale(d.variations[i]?.error?.[0]) ?? 0}
                      y1={(d) => yScale(d.variations[i]?.error?.[1]) ?? 0}
                      fill={COLORS[i % COLORS.length]}
                      opacity={0.12}
                      curve={curveMonotoneX}
                    />
                  ) : (
                    ""
                  );
                })}

                {variationNames.map((v, i) => {
                  // Render the actual line chart for each variation
                  return (
                    <LinePath
                      key={i}
                      data={datapoints}
                      x={(d) => xScale(d.d) ?? 0}
                      y={(d) => yScale(d.variations[i]?.value) ?? 0}
                      stroke={COLORS[i % COLORS.length]}
                      strokeWidth={2}
                      curve={curveMonotoneX}
                    />
                  );
                })}

                <AxisBottom
                  top={yMax}
                  scale={xScale}
                  numTicks={numXTicks}
                  tickLabelProps={() => ({
                    fill: "var(--text-color-table)",
                    fontSize: 11,
                    textAnchor: "middle",
                  })}
                  tickFormat={(d) => {
                    return date(d as Date);
                  }}
                  tickValues={specificXTicks}
                />
                <AxisLeft
                  scale={yScale}
                  numTicks={numYTicks}
                  tickFormat={(v) => tickFormat(v as number)}
                  tickLabelProps={() => ({
                    fill: "var(--text-color-table)",
                    fontSize: 11,
                    textAnchor: "end",
                  })}
                  label={label}
                  labelClassName="h5"
                />
              </Group>
            </svg>
          </>
        );
      }}
    </ParentSizeModern>
  );
};
export default ExperimentDateGraph;
