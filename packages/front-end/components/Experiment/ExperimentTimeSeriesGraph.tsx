import { FC, useMemo, useState } from "react";
import { format, startOfDay } from "date-fns";
import { ParentSizeModern } from "@visx/responsive";
import { Group } from "@visx/group";
import { Flex, Text } from "@radix-ui/themes";
import { GridColumns, GridRows } from "@visx/grid";
import { scaleLinear, scaleTime } from "@visx/scale";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { AreaClosed, LinePath } from "@visx/shape";
import { curveLinear, curveMonotoneX } from "@visx/curve";
import {
  TooltipWithBounds,
  useTooltip,
  useTooltipInPortal,
} from "@visx/tooltip";
import { date, getValidDate } from "shared/dates";
import { StatsEngine } from "back-end/types/stats";
import cloneDeep from "lodash/cloneDeep";
import { ScaleLinear } from "d3-scale";
import { BiCheckbox, BiCheckboxSquare } from "react-icons/bi";
import { pValueFormatter } from "@/services/experiments";
import { getVariationColor } from "@/services/features";
import HelperText from "@/components/Radix/HelperText";
import Table, {
  TableRow,
  TableHeader,
  TableBody,
  TableColumnHeader,
  TableRowHeaderCell,
  TableCell,
} from "../Radix/Table";
import styles from "./ExperimentDateGraph.module.scss";
import newStyles from "./ExperimentTimeSeriesGraph.module.scss";
import { RadixTheme } from "@/services/RadixTheme";
import Frame from "../Radix/Frame";

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

export interface ExperimentTimeSeriesGraphDataPoint {
  d: Date;
  variations?: DataPointVariation[]; // undefined === missing date
  helperText?: string;
}

export interface ExperimentTimeSeriesGraphProps {
  yaxis: "effect";
  variationNames: string[];
  label: string;
  datapoints: ExperimentTimeSeriesGraphDataPoint[];
  formatter: (value: number, options?: Intl.NumberFormatOptions) => string;
  formatterOptions?: Intl.NumberFormatOptions;
  statsEngine?: StatsEngine;
  hasStats?: boolean;
  maxGapHours?: number;
  cumulative?: boolean;
  showVariations: boolean[];
}

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 1,
});

type TooltipData = {
  x: number;
  y?: number[];
  d: ExperimentTimeSeriesGraphDataPoint;
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
  hasStats: boolean = true
) => {
  const { d, yaxis } = data;
  return (
    <>
      <Text weight="medium">{date(d.d)}</Text>
      {d.helperText ? (
        <HelperText status="info" my="2" size="md">
          {d.helperText}
        </HelperText>
      ) : null}
      <Table size="1">
        <TableHeader>
          <TableRow style={{ color: "var(--color-text-mid)" }}>
            <TableColumnHeader pl="0">Variation</TableColumnHeader>
            <TableColumnHeader justify="center">Users</TableColumnHeader>

            <TableColumnHeader justify="center">Value</TableColumnHeader>
            <TableColumnHeader justify="center">Change</TableColumnHeader>
            {hasStats && (
              <>
                <TableColumnHeader justify="center">CI</TableColumnHeader>
                <TableColumnHeader justify="center">
                  {statsEngine === "frequentist" ? "P-val" : "Chance to Win"}
                </TableColumnHeader>
              </>
            )}
          </TableRow>
        </TableHeader>

        <TableBody>
          {variationNames.map((v, i) => {
            if (!d.variations) return null;
            if (!showVariations[i]) return null;
            const variation = d.variations[i];
            const variationColor = getVariationColor(i, true);
            return (
              <TableRow
                key={i}
                style={{
                  color: "var(--color-text-high)",
                  // @ts-expect-error cssType is not aware of CSS variables
                  fontWeight: "500",
                }}
              >
                <TableRowHeaderCell pl="0">
                  <Flex align="center" gap="2">
                    <span
                      className="label"
                      style={{
                        color: variationColor,
                        borderColor: variationColor,
                        fontSize: "12px",
                        width: 16,
                        height: 16,
                        borderRadius: 16,
                        borderWidth: 1,
                        borderStyle: "solid",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      {i}
                    </span>
                    <Text weight="bold">{v}</Text>
                  </Flex>
                </TableRowHeaderCell>
                {yaxis === "users" && (
                  <TableCell justify="center">
                    {d.variations[i].v_formatted}
                  </TableCell>
                )}
                {yaxis === "effect" && (
                  <>
                    <TableCell justify="center">
                      {d.variations[i].users}
                    </TableCell>
                    <TableCell justify="center">
                      {d.variations[i].v_formatted}
                    </TableCell>
                    <TableCell justify="center">
                      {i > 0 && (
                        <>
                          {((variation.up ?? 0) > 0 ? "+" : "") +
                            formatter(variation.up ?? 0, formatterOptions)}
                        </>
                      )}
                    </TableCell>
                    {hasStats && (
                      <>
                        <TableCell justify="center">
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
                        </TableCell>
                        <TableCell justify="center">
                          {i > 0 && (
                            <>
                              {statsEngine === "frequentist"
                                ? typeof variation.p === "number" &&
                                  pValueFormatter(variation.p)
                                : typeof variation.ctw === "number" &&
                                  percentFormatter.format(variation.ctw)}
                            </>
                          )}
                        </TableCell>
                      </>
                    )}
                  </>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </>
  );
};

// Finds the closest date to the cursor and figures out x/y coordinates
const getTooltipData = (
  mx: number,
  width: number,
  datapoints: ExperimentTimeSeriesGraphDataPoint[],
  yScale: ScaleLinear<number, number, never>,
  xScale,
  yaxis: "users" | "effect"
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
  const y = d.variations
    ? d.variations.map(
        (variation) => yScale(getYVal(variation, yaxis) ?? 0) ?? 0
      )
    : undefined;
  return { x, y, d, yaxis };
};

const getYVal = (
  variation?: DataPointVariation,
  yaxis?: "users" | "effect"
) => {
  if (!variation) return undefined;
  switch (yaxis) {
    case "users":
      return variation.v;
    case "effect":
      return variation.up;
    default:
      return variation.v;
  }
};

const ExperimentTimeSeriesGraph: FC<ExperimentTimeSeriesGraphProps> = ({
  yaxis,
  datapoints: _datapoints,
  variationNames,
  label,
  formatter,
  formatterOptions,
  showVariations,
  statsEngine = "bayesian",
  hasStats = true,
  maxGapHours = 36,
  cumulative = false,
}) => {
  // yaxis = "users";
  const { containerRef, containerBounds, TooltipInPortal } = useTooltipInPortal(
    {
      scroll: true,
      detectBounds: true,
    }
  );

  const {
    showTooltip,
    // hideTooltip,
    tooltipOpen,
    tooltipData,
    tooltipLeft = 0,
    tooltipTop = 0,
  } = useTooltip<TooltipData>();

  const datapoints = useMemo(() => {
    const sortedDates1 = cloneDeep(_datapoints)
      .sort((a, b) => getValidDate(a.d).getTime() - getValidDate(b.d).getTime())
      .map((p) => ({
        ...p,
        d: startOfDay(p.d),
      }));

    const lastDataPointIndexWithHelperText = sortedDates1.findLastIndex(
      (it) => it.helperText
    );

    const sortedDates = sortedDates1.map((p, idx) => {
      if (idx < lastDataPointIndexWithHelperText) {
        return {
          ...p,
          helperText: "Settings do not match current version",
        };
      } else {
        return { ...p, helperText: undefined };
      }
    });

    const filledDates: ExperimentTimeSeriesGraphDataPoint[] = [];
    for (let i = 0; i < sortedDates.length; i++) {
      filledDates.push(sortedDates[i]);
      if (i < sortedDates.length - 1) {
        const currentDate = getValidDate(sortedDates[i].d);
        const nextDate = getValidDate(sortedDates[i + 1].d);
        let expectedDate = new Date(
          currentDate.getTime() + maxGapHours * 60 * 60 * 1000
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
            expectedDate.getTime() + maxGapHours * 60 * 60 * 1000
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
                .map((variation) => getYVal(variation, yaxis) ?? 0)
            )
          : 0
      )
    );
    const maxValue = Math.max(
      ...datapoints.map((d) =>
        d?.variations
          ? Math.max(
              ...d.variations
                .filter((_, i) => showVariations[i])
                .map((variation) => getYVal(variation, yaxis) ?? 0)
            )
          : 0
      )
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
                    : getYVal(variation, yaxis) ?? 0
                )
            )
          : 0
      )
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
                    : getYVal(variation, yaxis) ?? 0
                )
            )
          : 0
      )
    );

    // TODO: Disable for metric timeseries now
    // The error bars can be huge sometimes, so limit the domain to at most twice the min/max value
    const heyDatapoints = datapoints.filter(
      (it) => it.variations !== undefined
    );
    const lastDataPoint = heyDatapoints[heyDatapoints.length - 1];

    // Get the midpoint between min and max values
    // const minMidpoint = minValue;
    // const maxMidpoint = maxValue;

    // Ensure we show the full CI for the latest data point
    const latestMinCI = lastDataPoint?.variations
      ? Math.min(
          ...lastDataPoint.variations
            .filter((_, i) => showVariations[i])
            .map(
              (variation) => variation.ci?.[0] ?? getYVal(variation, yaxis) ?? 0
            )
        )
      : 0;

    const latestMaxCI = lastDataPoint?.variations
      ? Math.max(
          ...lastDataPoint.variations
            .filter((_, i) => showVariations[i])
            .map(
              (variation) => variation.ci?.[1] ?? getYVal(variation, yaxis) ?? 0
            )
        )
      : 0;

    // Calculate range based on latest data point (10x the range)
    const latestRange = Math.abs(latestMaxCI - latestMinCI);
    const expandedRange = latestRange * 10;
    const midpoint = (latestMaxCI + latestMinCI) / 2;
    const expandedMin = midpoint - expandedRange / 2;
    const expandedMax = midpoint + expandedRange / 2;

    console.table({
      minValue,
      maxValue,
      latestMinCI,
      latestMaxCI,
      expandedMin,
      expandedMax,
    });

    const min = Math.min(
      minValue,
      latestMinCI,
      Math.max(expandedMin, minError)
    );
    const max = Math.max(
      maxValue,
      latestMaxCI,
      Math.min(expandedMax, maxError)
    );
    const range = max - min;
    const expandedRange2 = range * 1.05;
    const buffer = (expandedRange2 - range) / 2;
    return [min - buffer, max + buffer];
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
            yaxis
          );
          if (!data?.y || data.y.every((v) => v === undefined)) {
            // hideTooltip();
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
              <TooltipInPortal
                key={Math.random()}
                className={newStyles.tooltip}
                left={tooltipLeft}
                top={tooltipTop + margin[0]}
                unstyled={true}
              >
                <RadixTheme>
                  <div className={newStyles.tooltipContent}>
                    {getTooltipContents(
                      tooltipData,
                      variationNames,
                      showVariations,
                      statsEngine,
                      formatter,
                      formatterOptions,
                      hasStats
                    )}
                  </div>
                </RadixTheme>
              </TooltipInPortal>
            )}
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
              // onPointerLeave={hideTooltip}
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
                </>
              )}
            </div>
            <svg width={width} height={height}>
              <defs>
                <clipPath id="experiment-date-graph-clip">
                  <rect
                    x={0}
                    y={0}
                    width={width - margin[1] - margin[3]}
                    height={height - margin[0] - margin[2]}
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
                          data={datapoints.filter(
                            (it) => it.variations !== undefined
                          )}
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
                    // TODO: wth is this +2?
                    const lastIndex =
                      datapoints.findLastIndex((it) => it.helperText) + 2;

                    // NB: We include lastIndex datapoint in both arrays as we need
                    // to draw the dashed line to it, and the solid line from it onwards
                    const previousSettingsDataPoints = datapoints.filter(
                      (it, idx) =>
                        it.variations !== undefined && idx <= lastIndex
                    );
                    const currentSettingsDataPoints = datapoints.filter(
                      (it, idx) =>
                        it.variations !== undefined && idx >= lastIndex
                    );
                    return (
                      <>
                        <LinePath
                          key={`linepath_dashed_${i}`}
                          data={previousSettingsDataPoints}
                          x={(d) => xScale(d.d)}
                          y={(d) =>
                            yScale(getYVal(d?.variations?.[i], yaxis) ?? 0)
                          }
                          stroke={getVariationColor(i, true)}
                          strokeWidth={2}
                          strokeDasharray={3}
                          strokeLinecap="butt"
                          curve={curveLinear}
                        />
                        <LinePath
                          key={`linepath_solid_${i}`}
                          data={currentSettingsDataPoints}
                          x={(d) => xScale(d.d)}
                          y={(d) =>
                            yScale(getYVal(d?.variations?.[i], yaxis) ?? 0)
                          }
                          stroke={getVariationColor(i, true)}
                          strokeWidth={2}
                          curve={curveLinear}
                        />
                      </>
                    );
                  })}
                </Group>

                <AxisBottom
                  top={yMax}
                  scale={xScale}
                  numTicks={numXTicks}
                  tickLabelProps={(d) => {
                    return {
                      fill:
                        d < new Date("2025-04-01") || d > new Date("2025-04-03")
                          ? "var(--color-text-low)"
                          : "var(--color-text-high)",
                      fontSize: 11,
                      textAnchor: "middle",
                    };
                  }}
                  tickFormat={(d) => {
                    return format(d as Date, "MMM dd");
                  }}
                  tickValues={numXTicks < 7 ? allXTicks : undefined}
                />
                <AxisLeft
                  scale={yScale}
                  numTicks={numYTicks}
                  labelOffset={50}
                  tickFormat={(v) => formatter(v as number, formatterOptions)}
                  tickLabelProps={() => ({
                    fill: "var(--color-text-mid)",
                    fontSize: 11,
                    textAnchor: "end",
                  })}
                  label={label}
                  labelProps={{
                    fill: "var(--color-text-mid)",
                    textAnchor: "middle",
                  }}
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
export default ExperimentTimeSeriesGraph;
