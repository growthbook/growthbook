import { FC, useMemo, useState } from "react";
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
import { date, getValidDate } from "shared/dates";
import { StatsEngine } from "shared/types/stats";
import cloneDeep from "lodash/cloneDeep";
import { ScaleLinear } from "d3-scale";
import { BiCheckbox, BiCheckboxSquare } from "react-icons/bi";
import { pValueFormatter } from "@/services/experiments";
import { getVariationColor } from "@/services/features";
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
  variations?: DataPointVariation[]; // undefined === missing date
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
  maxGapHours?: number;
  cumulative?: boolean;
}

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 1,
});

type TooltipData = {
  x: number;
  y?: number[];
  d: ExperimentDateGraphDataPoint;
  yaxis: "users" | "effect";
};

const height = 220;
const margin = [15, 15, 30, 80];

// Render the contents of a tooltip
const getTooltipContents = (
  data: TooltipData,
  variationNames: string[],
  showVariations: boolean[],
  statsEngine: StatsEngine,
  formatter: (value: number, options?: Intl.NumberFormatOptions) => string,
  formatterOptions?: Intl.NumberFormatOptions,
  hasStats: boolean = true,
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
            <td>Units</td>

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
            if (!d.variations) return null;
            if (!showVariations[i]) return null;
            const variation = d.variations[i];
            return (
              <tr key={i}>
                <td
                  className="text-ellipsis"
                  style={{ color: getVariationColor(i, true) }}
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
                                formatterOptions,
                              )}
                              ,{" "}
                              {formatter(
                                variation?.ci?.[1] ?? 0,
                                formatterOptions,
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
  yaxis: "users" | "effect",
): TooltipData => {
  // Calculate x-coordinates for all data points
  const xCoords = datapoints.map((d) => xScale(d.d));

  // Find the closest data point based on mouse x-coordinate
  let closestIndex = 0;
  let minDistance = Infinity;

  for (let i = 0; i < xCoords.length; i++) {
    const distance = Math.abs(mx - xCoords[i]);
    if (distance < minDistance) {
      minDistance = distance;
      closestIndex = i;
    }
  }

  const d = datapoints[closestIndex];
  const x = xCoords[closestIndex];
  const y = d?.variations
    ? d.variations.map(
        (variation) => yScale(getYVal(variation, yaxis) ?? 0) ?? 0,
      )
    : undefined;
  return { x, y, d, yaxis };
};

const getYVal = (
  variation?: DataPointVariation,
  yaxis?: "users" | "effect",
) => {
  if (!variation) return undefined;
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
  datapoints: _datapoints,
  variationNames,
  label,
  formatter,
  formatterOptions,
  statsEngine = "bayesian",
  hasStats = true,
  maxGapHours = 36,
  cumulative = false,
}) => {
  // yaxis = "users";
  const { containerRef, containerBounds } = useTooltipInPortal({
    scroll: true,
    detectBounds: true,
  });

  const [showVariations, setShowVariations] = useState<boolean[]>(
    variationNames.map(() => true),
  );

  const {
    showTooltip,
    hideTooltip,
    tooltipOpen,
    tooltipData,
    tooltipLeft = 0,
    tooltipTop = 0,
  } = useTooltip<TooltipData>();

  const datapoints = useMemo(() => {
    const sortedDates = cloneDeep(_datapoints).sort(
      (a, b) => getValidDate(a.d).getTime() - getValidDate(b.d).getTime(),
    );

    const filledDates: ExperimentDateGraphDataPoint[] = [];
    for (let i = 0; i < sortedDates.length; i++) {
      filledDates.push(sortedDates[i]);
      if (i < sortedDates.length - 1) {
        const currentDate = getValidDate(sortedDates[i].d);
        const nextDate = getValidDate(sortedDates[i + 1].d);
        let expectedDate = new Date(
          currentDate.getTime() + maxGapHours * 60 * 60 * 1000,
        );

        while (expectedDate < nextDate) {
          if (cumulative) {
            filledDates.push({
              ...sortedDates[i],
              d: expectedDate,
            });
          } else {
            filledDates.push({
              d: expectedDate,
            });
          }
          expectedDate = new Date(
            expectedDate.getTime() + maxGapHours * 60 * 60 * 1000,
          );
        }
      }
    }
    return filledDates;
  }, [_datapoints, cumulative, maxGapHours]);

  // Get y-axis domain
  const yDomain = useMemo<[number, number]>(() => {
    const minValue = Math.min(
      ...datapoints.map((d) =>
        d?.variations
          ? Math.min(
              ...d.variations
                .filter((_, i) => showVariations[i])
                .map((variation) => getYVal(variation, yaxis) ?? 0),
            )
          : 0,
      ),
    );
    const maxValue = Math.max(
      ...datapoints.map((d) =>
        d?.variations
          ? Math.max(
              ...d.variations
                .filter((_, i) => showVariations[i])
                .map((variation) => getYVal(variation, yaxis) ?? 0),
            )
          : 0,
      ),
    );
    const minError = Math.min(
      ...datapoints.map((d) =>
        d?.variations
          ? Math.min(
              ...d.variations
                .filter((_, i) => showVariations[i])
                .map((variation) =>
                  variation.ci?.[0]
                    ? variation.ci[0]
                    : (getYVal(variation, yaxis) ?? 0),
                ),
            )
          : 0,
      ),
    );
    const maxError = Math.max(
      ...datapoints.map((d) =>
        d?.variations
          ? Math.max(
              ...d.variations
                .filter((_, i) => showVariations[i])
                .map((variation) =>
                  variation.ci?.[1]
                    ? variation.ci[1]
                    : (getYVal(variation, yaxis) ?? 0),
                ),
            )
          : 0,
      ),
    );

    // The error bars can be huge sometimes, so limit the domain to at most twice the min/max value
    return [
      Math.max(minError, minValue > 0 ? minValue / 2 : minValue * 2),
      Math.min(maxError, maxValue > 0 ? maxValue * 2 : maxValue / 2),
    ];
  }, [datapoints, yaxis, showVariations]);

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
        const allXTicks = datapoints.map((p) => p.d.getTime());

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
            yaxis,
          );
          if (!data?.y || data.y.every((v) => v === undefined)) {
            hideTooltip();
            return;
          }
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
                  showVariations,
                  statsEngine,
                  formatter,
                  formatterOptions,
                  hasStats,
                )}
              </TooltipWithBounds>
            )}
            <div className="d-flex align-items-start">
              <div
                className="d-flex flex-wrap px-3 mb-2"
                style={{ gap: "0.25rem 1rem" }}
              >
                <div
                  key={"all"}
                  className="nowrap cursor-pointer hover-highlight py-1 pr-1 rounded user-select-none"
                  onClick={() => {
                    if (!showVariations.every((sv) => sv)) {
                      setShowVariations(variationNames.map(() => true));
                    } else {
                      setShowVariations(
                        variationNames.map((_, i) => (i === 0 ? true : false)),
                      );
                    }
                  }}
                >
                  {showVariations.every((sv) => sv) ? (
                    <BiCheckboxSquare size={24} />
                  ) : (
                    <BiCheckbox size={24} />
                  )}
                  Show all
                </div>
                {variationNames.map((v, i) => {
                  if (i === 0 && yaxis === "effect") return null;
                  return (
                    <div
                      key={i}
                      className="nowrap text-ellipsis cursor-pointer hover-highlight py-1 pr-1 rounded user-select-none"
                      style={{
                        maxWidth: 200,
                        color: getVariationColor(i, true),
                      }}
                      onClick={() => {
                        let sv = [...showVariations];
                        sv[i] = !sv[i];
                        if (sv.every((v) => !v)) {
                          sv = variationNames.map((_, j) => i !== j);
                        }
                        setShowVariations(sv);
                      }}
                    >
                      {showVariations[i] ? (
                        <BiCheckboxSquare size={24} />
                      ) : (
                        <BiCheckbox size={24} />
                      )}
                      {v}
                    </div>
                  );
                })}
              </div>
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
                    if (!showVariations[i]) return null;
                    if (yaxis === "effect" && i === 0) {
                      return;
                    }
                    // Render a dot at the current x location for each variation
                    return (
                      <div
                        key={i}
                        className={styles.positionIndicator}
                        style={{
                          transform: `translate(${tooltipLeft}px, ${
                            tooltipData?.y?.[i] ?? 0
                          }px)`,
                          background: getVariationColor(i, true),
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
              <defs>
                <clipPath id="experiment-date-graph-clip">
                  <rect
                    x={0}
                    y={0}
                    width={Math.max(0, width - margin[1] - margin[3])}
                    height={Math.max(0, height - margin[0] - margin[2])}
                  />
                </clipPath>
              </defs>
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
                  tickValues={numXTicks < 7 ? allXTicks : undefined}
                />

                <Group clipPath="url(#experiment-date-graph-clip)">
                  {variationNames.map((v, i) => {
                    if (!showVariations[i]) return null;
                    if (yaxis === "effect" && i === 0) {
                      return <></>;
                    }
                    // Render a shaded area for error bars for each variation if defined
                    return (
                      typeof datapoints[0]?.variations?.[i]?.ci !==
                        "undefined" && (
                        <AreaClosed
                          key={`ci_${i}`}
                          yScale={yScale}
                          data={datapoints}
                          x={(d) => xScale(d.d) ?? 0}
                          y0={(d) =>
                            yScale(d?.variations?.[i]?.ci?.[0] ?? 0) ?? 0
                          }
                          y1={(d) =>
                            yScale(d?.variations?.[i]?.ci?.[1] ?? 0) ?? 0
                          }
                          fill={getVariationColor(i, true)}
                          opacity={0.12}
                          curve={curveMonotoneX}
                        />
                      )
                    );
                  })}

                  {variationNames.map((_, i) => {
                    if (!showVariations[i]) return null;
                    if (yaxis === "effect" && i === 0) {
                      return null;
                    }
                    // Render the actual line chart for each variation
                    return (
                      <LinePath
                        key={`linepath_${i}`}
                        data={datapoints}
                        x={(d) => xScale(d.d)}
                        y={(d) =>
                          yScale(getYVal(d?.variations?.[i], yaxis) ?? 0)
                        }
                        stroke={getVariationColor(i, true)}
                        strokeWidth={2}
                        curve={curveMonotoneX}
                        defined={(d) =>
                          getYVal(d?.variations?.[i], yaxis) !== undefined
                        }
                      />
                    );
                  })}
                </Group>

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
                  tickValues={numXTicks < 7 ? allXTicks : undefined}
                />
                <AxisLeft
                  scale={yScale}
                  numTicks={numYTicks}
                  labelOffset={50}
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
