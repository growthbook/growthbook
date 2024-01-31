import { FC, useMemo } from "react";
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
import { date } from "shared/dates";
import { variant_0, variant_1, variant_2, variant_3 } from "shared/constants";
import { StatsEngine } from "back-end/types/stats";
import { pValueFormatter } from "@/services/experiments";
import styles from "./ExperimentDateGraph.module.scss";

export interface DataPointVariation {
  v: number;
  v_formatted: string;
  users?: number; // used for uplift plot tooltips
  up?: number; // uplift
  p?: number; // p-value
  ctw?: number; // chance to win
  ci?: [number, number]; // confidence interval
  className?: string; // won/lost/draw class
}
export interface ExperimentDateGraphDataPoint {
  d: Date;
  variations: DataPointVariation[];
}
export interface ExperimentDateGraphProps {
  yaxis: "users" | "effect";
  variationNames: string[];
  label: string;
  datapoints: ExperimentDateGraphDataPoint[];
  formatter: (value: number, options?: Intl.NumberFormatOptions) => string;
  formatterOptions?: Intl.NumberFormatOptions;
  statsEngine?: StatsEngine;
  hasStats?: boolean;
}

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 1,
});

const COLORS = [variant_0, variant_1, variant_2, variant_3];

type TooltipData = {
  x: number;
  y: number[];
  d: ExperimentDateGraphDataPoint;
  yaxis: "users" | "effect";
};

const height = 220;
const margin = [15, 15, 30, 80];

// Render the contents of a tooltip
const getTooltipContents = (
  data: TooltipData,
  variationNames: string[],
  statsEngine: StatsEngine,
  formatter: (value: number, options?: Intl.NumberFormatOptions) => string,
  formatterOptions?: Intl.NumberFormatOptions,
  hasStats: boolean = true
) => {
  const { d, yaxis } = data;
  return (
    <>
      <table
        className={`table-condensed ${styles.table} ${
          yaxis !== "effect" && "mt-1"
        }`}
      >
        <thead>
          <tr>
            <td></td>
            <td>Users</td>

            {yaxis === "effect" && (
              <>
                <td>Value</td>
                <td>Change</td>
                {hasStats && (
                  <>
                    <td>CI</td>
                    <td>
                      {statsEngine === "frequentist"
                        ? "P-val"
                        : "Chance to Win"}
                    </td>
                  </>
                )}
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {variationNames.map((v, i) => {
            const variation = d.variations[i];
            return (
              <tr key={i}>
                <td
                  className="text-ellipsis"
                  style={{ color: COLORS[i % COLORS.length] }}
                >
                  {v}
                </td>
                {yaxis === "users" && <td>{d.variations[i].v_formatted}</td>}
                {yaxis === "effect" && (
                  <>
                    <td>{d.variations[i].users}</td>
                    <td>{d.variations[i].v_formatted}</td>
                    <td>
                      {i > 0 && (
                        <>
                          {((variation.up ?? 0) > 0 ? "+" : "") +
                            formatter(variation.up ?? 0, formatterOptions)}
                        </>
                      )}
                    </td>
                    {hasStats && (
                      <>
                        <td className="small">
                          {i > 0 && (
                            <>
                              [
                              {formatter(
                                variation?.ci?.[0] ?? 0,
                                formatterOptions
                              )}
                              ,{" "}
                              {formatter(
                                variation?.ci?.[1] ?? 0,
                                formatterOptions
                              )}
                              ]
                            </>
                          )}
                        </td>
                        <td className={variation.className}>
                          {i > 0 && (
                            <>
                              {statsEngine === "frequentist"
                                ? typeof variation.p === "number" &&
                                  pValueFormatter(variation.p)
                                : typeof variation.ctw === "number" &&
                                  percentFormatter.format(variation.ctw)}
                            </>
                          )}
                        </td>
                      </>
                    )}
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="text-sm-right mt-1 mr-1">{date(d.d as Date)}</div>
    </>
  );
};

// Finds the closest date to the cursor and figures out x/y coordinates
const getTooltipData = (
  mx: number,
  width: number,
  datapoints: ExperimentDateGraphDataPoint[],
  yScale: ScaleLinear<number, number, never>,
  xScale,
  yaxis: "users" | "effect"
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
  const y = d.variations.map(
    (variation) => yScale(getYVal(variation, yaxis)) ?? 0
  );
  return { x, y, d, yaxis };
};

const getYVal = (variation: DataPointVariation, yaxis: "users" | "effect") => {
  switch (yaxis) {
    case "users":
      return variation.v;
    case "effect":
      return variation.up ?? 0;
    default:
      return variation.v;
  }
};

const ExperimentDateGraph: FC<ExperimentDateGraphProps> = ({
  yaxis,
  datapoints,
  variationNames,
  label,
  formatter,
  formatterOptions,
  statsEngine = "bayesian",
  hasStats = true,
}) => {
  // yaxis = "users";
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
      ...datapoints.map((d) =>
        Math.min(...d.variations.map((variation) => getYVal(variation, yaxis)))
      )
    );
    const maxValue = Math.max(
      ...datapoints.map((d) =>
        Math.max(...d.variations.map((variation) => getYVal(variation, yaxis)))
      )
    );
    const minError = Math.min(
      ...datapoints.map((d) =>
        Math.min(
          ...d.variations.map((variation) =>
            variation.ci?.[0] ? variation.ci[0] : getYVal(variation, yaxis)
          )
        )
      )
    );
    const maxError = Math.max(
      ...datapoints.map((d) =>
        Math.max(
          ...d.variations.map((variation) =>
            variation.ci?.[1] ? variation.ci[1] : getYVal(variation, yaxis)
          )
        )
      )
    );

    // The error bars can be huge sometimes, so limit the domain to at most twice the min/max value
    return [
      Math.max(minError, minValue > 0 ? minValue / 2 : minValue * 2),
      Math.min(maxError, maxValue > 0 ? maxValue * 2 : maxValue / 2),
    ];
  }, [datapoints, yaxis]);

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
            xScale,
            yaxis
          );
          showTooltip({
            tooltipLeft: data.x,
            tooltipTop: Math.max(Math.min(...data.y), 150),
            tooltipData: data,
          });
        };

        return (
          <div className="position-relative">
            {tooltipData && (
              <TooltipWithBounds
                left={tooltipLeft + margin[3]}
                top={tooltipTop + margin[0]}
                className={`tooltip-experimentDateGraph ${styles.tooltip}`}
                unstyled={true}
              >
                {getTooltipContents(
                  tooltipData,
                  variationNames,
                  statsEngine,
                  formatter,
                  formatterOptions,
                  hasStats
                )}
              </TooltipWithBounds>
            )}
            <div className="d-flex">
              {variationNames.map((v, i) => {
                return (
                  <div
                    key={i}
                    className="mx-2"
                    style={{ color: COLORS[i % COLORS.length] }}
                  >
                    <strong>&mdash;</strong>&nbsp;{v}
                  </div>
                );
              })}
            </div>
            <div
              ref={containerRef}
              className={styles.dategraph}
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
                    if (yaxis === "effect" && i === 0) {
                      return;
                    }
                    // Render a dot at the current x location for each variation
                    return (
                      <div
                        key={i}
                        className={styles.positionIndicator}
                        style={{
                          transform: `translate(${tooltipLeft}px, ${tooltipData?.y[i]}px)`,
                          background: COLORS[i % COLORS.length],
                        }}
                      />
                    );
                  })}
                  <div
                    className={styles.crosshair}
                    style={{ transform: `translateX(${tooltipLeft}px)` }}
                  />
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
                  if (yaxis === "effect" && i === 0) {
                    return <></>;
                  }
                  // Render a shaded area for error bars for each variation if defined
                  return (
                    typeof datapoints[0]?.variations?.[i]?.ci !==
                      "undefined" && (
                      <AreaClosed
                        key={i}
                        yScale={yScale}
                        data={datapoints}
                        x={(d) => xScale(d.d) ?? 0}
                        y0={(d) => yScale(d.variations[i]?.ci?.[0] ?? 0) ?? 0}
                        y1={(d) => yScale(d.variations[i]?.ci?.[1] ?? 0) ?? 0}
                        fill={COLORS[i % COLORS.length]}
                        opacity={0.12}
                        curve={curveMonotoneX}
                      />
                    )
                  );
                })}

                {variationNames.map((v, i) => {
                  if (yaxis === "effect" && i === 0) {
                    return <></>;
                  }
                  // Render the actual line chart for each variation
                  return (
                    <LinePath
                      key={i}
                      data={datapoints}
                      x={(d) => xScale(d.d) ?? 0}
                      y={(d) => yScale(getYVal(d.variations[i], yaxis)) ?? 0}
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
                  tickFormat={(v) => formatter(v as number, formatterOptions)}
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
          </div>
        );
      }}
    </ParentSizeModern>
  );
};
export default ExperimentDateGraph;
