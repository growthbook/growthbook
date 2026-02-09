import React, { FC, useMemo } from "react";
import { format } from "date-fns";
import { ParentSizeModern } from "@visx/responsive";
import { Group } from "@visx/group";
import { Box, Flex } from "@radix-ui/themes";
import { GridColumns, GridRows } from "@visx/grid";
import { scaleLinear, scaleTime } from "@visx/scale";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { AreaClosed, LinePath } from "@visx/shape";
import { curveLinear, curveMonotoneX } from "@visx/curve";
import { useTooltip, useTooltipInPortal } from "@visx/tooltip";
import { datetime, getValidDate } from "shared/dates";
import { StatsEngine } from "shared/types/stats";
import cloneDeep from "lodash/cloneDeep";
import { NumberValue, ScaleLinear, ScaleTime } from "d3-scale";
import { pValueFormatter } from "@/services/experiments";
import { getVariationColor } from "@/services/features";
import { RadixTheme } from "@/services/RadixTheme";
import HelperText from "@/ui/HelperText";
import Text from "@/ui/Text";
import Table, {
  TableRow,
  TableHeader,
  TableBody,
  TableColumnHeader,
  TableRowHeaderCell,
  TableCell,
} from "@/ui/Table";
import styles from "./ExperimentDateGraph.module.scss";
import timeSeriesStyles from "./ExperimentTimeSeriesGraph.module.scss";

type AxisType = "effect"; // TODO: eventually will have variation means
export interface DataPointVariation {
  v: number;
  v_formatted: string;
  users?: number;
  up?: number; // uplift
  p?: number; // p-value
  ctw?: number; // chance to win
  ci?: [number, number]; // confidence interval
  className?: string; // won/lost/draw class
}

export interface ExperimentTimeSeriesGraphDataPoint {
  d: Date;
  variations?: Array<DataPointVariation | null>; // undefined === missing date, null === variation not present
  helperText?: string;
}

export interface ExperimentTimeSeriesGraphProps {
  yaxis: AxisType;
  variationNames: string[];
  label: string;
  datapoints: ExperimentTimeSeriesGraphDataPoint[];
  formatter: (value: number, options?: Intl.NumberFormatOptions) => string;
  formatterOptions?: Intl.NumberFormatOptions;
  statsEngine: StatsEngine;
  usesPValueAdjustment: boolean;
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
  yaxis: AxisType;
};

const height = 220;
const margin = [15, 30, 30, 80];

// Render the contents of a tooltip
const getTooltipContents = (
  data: TooltipData,
  variationNames: string[],
  showVariations: boolean[],
  statsEngine: StatsEngine,
  usesPValueAdjustment: boolean,
  formatter: (value: number, options?: Intl.NumberFormatOptions) => string,
  formatterOptions?: Intl.NumberFormatOptions,
  hasStats: boolean = true,
) => {
  const { d, yaxis } = data;

  const bayesian = d.variations?.some((v) => v?.ctw !== undefined);
  const frequentist = d.variations?.some((v) => v?.p !== undefined);
  const usedStatsEngine = bayesian
    ? "bayesian"
    : frequentist
      ? "frequentist"
      : statsEngine;

  const showAdjustmentNote =
    usesPValueAdjustment &&
    statsEngine === "frequentist" &&
    usedStatsEngine === "frequentist";

  return (
    <>
      <Text weight="medium">{datetime(d.d)}</Text>
      {d.helperText ? (
        <HelperText status="info" my="2" size="md">
          {d.helperText}
        </HelperText>
      ) : null}
      <Table size="1">
        <TableHeader style={{ fontSize: "12px" }}>
          <TableRow style={{ color: "var(--color-text-mid)" }}>
            <TableColumnHeader pl="0">Variation</TableColumnHeader>
            <TableColumnHeader justify="center">Users</TableColumnHeader>
            <TableColumnHeader justify="center">Value</TableColumnHeader>
            <TableColumnHeader justify="center">Change</TableColumnHeader>
            {hasStats && (
              <>
                <TableColumnHeader justify="center">
                  CI{showAdjustmentNote ? "*" : null}
                </TableColumnHeader>
                <TableColumnHeader justify="center">
                  {usedStatsEngine === "frequentist"
                    ? "P-val"
                    : "Chance to Win"}
                  {showAdjustmentNote ? "*" : null}
                </TableColumnHeader>
              </>
            )}
          </TableRow>
        </TableHeader>

        <TableBody style={{ fontSize: "12px" }}>
          {variationNames.map((v, i) => {
            if (!d.variations) return null;
            if (!showVariations[i]) return null;
            const variation = d.variations[i];
            if (!variation) return null;
            const variationColor = getVariationColor(i, true);
            return (
              <TableRow
                key={`tooltip_row_${i}`}
                style={{
                  color: "var(--color-text-high)",
                  fontWeight: 500,
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
                    <Text weight="semibold">{v}</Text>
                  </Flex>
                </TableRowHeaderCell>
                {yaxis === "effect" && (
                  <>
                    <TableCell
                      justify="center"
                      style={{ fontWeight: "normal" }}
                    >
                      {variation.users}
                    </TableCell>
                    <TableCell
                      justify="center"
                      style={{ fontWeight: "normal" }}
                    >
                      {variation.v_formatted}
                    </TableCell>
                    <TableCell justify="center" style={{ fontWeight: "bold" }}>
                      {i > 0 && (
                        <>
                          {((variation.up ?? 0) > 0 ? "+" : "") +
                            formatter(variation.up ?? 0, formatterOptions)}
                        </>
                      )}
                    </TableCell>
                    {hasStats && (
                      <>
                        <TableCell
                          justify="center"
                          style={{ fontWeight: "normal" }}
                        >
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
                        </TableCell>
                        <TableCell justify="center">
                          {i > 0 && (
                            <>
                              {usedStatsEngine === "frequentist"
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
      {showAdjustmentNote ? (
        <Box>
          <Text size="small" my="2">
            * P-values and CIs not adjusted for multiple comparisons.
          </Text>
        </Box>
      ) : null}
    </>
  );
};

// Finds the closest date to the cursor and figures out x/y coordinates
const getTooltipData = (
  mx: number,
  datapoints: ExperimentTimeSeriesGraphDataPoint[],
  yScale: ScaleLinear<number, number, never>,
  xScale: ScaleTime<number, number, never>,
  yaxis: AxisType,
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

  // Ensure we use the latest point in case of multiple values in the same coord
  closestIndex = datapoints.findLastIndex(
    (_, index) => xCoords[index] === xCoords[closestIndex],
  );
  const d = datapoints[closestIndex];
  const x = xCoords[closestIndex];
  const y = d.variations
    ? d.variations.map(
        (variation) => yScale(getYVal(variation ?? undefined, yaxis) ?? 0) ?? 0,
      )
    : undefined;
  return { x, y, d, yaxis };
};

const getYVal = (variation?: DataPointVariation, yaxis?: AxisType) => {
  if (!variation) return undefined;
  switch (yaxis) {
    case "effect":
      return variation.up;
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
  statsEngine,
  usesPValueAdjustment,
  hasStats = true,
  maxGapHours = 36,
  cumulative = false,
}) => {
  const { containerRef, containerBounds, TooltipInPortal } = useTooltipInPortal(
    {
      scroll: true,
      detectBounds: true,
    },
  );

  const {
    showTooltip,
    hideTooltip,
    tooltipOpen,
    tooltipData,
    tooltipLeft = 0,
    tooltipTop = 0,
  } = useTooltip<TooltipData>();

  const sortedDates = useMemo(
    () =>
      cloneDeep(_datapoints).sort(
        (a, b) => getValidDate(a.d).getTime() - getValidDate(b.d).getTime(),
      ),
    [_datapoints],
  );

  const sortedDatesWithData = useMemo(() => {
    return sortedDates.filter((d) => d.variations && d.variations.length > 0);
  }, [sortedDates]);

  const datapoints = useMemo(() => {
    const filledDates: ExperimentTimeSeriesGraphDataPoint[] = [];
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
  }, [sortedDates, cumulative, maxGapHours]);

  // Get y-axis domain
  const yDomain = useMemo<[number, number]>(() => {
    const minValue = Math.min(
      ...datapoints.map((d) =>
        d?.variations
          ? Math.min(
              ...d.variations
                .filter((_, i) => showVariations[i])
                .map(
                  (variation) => getYVal(variation ?? undefined, yaxis) ?? 0,
                ),
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
                .map(
                  (variation) => getYVal(variation ?? undefined, yaxis) ?? 0,
                ),
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
                  variation?.ci?.[0]
                    ? variation.ci[0]
                    : (getYVal(variation ?? undefined, yaxis) ?? 0),
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
                  variation?.ci?.[1]
                    ? variation.ci[1]
                    : (getYVal(variation ?? undefined, yaxis) ?? 0),
                ),
            )
          : 0,
      ),
    );

    const lastDataPointWithData =
      sortedDatesWithData[sortedDatesWithData.length - 1];

    // Ensure we show the full CI for the latest data point
    const latestMinCI = lastDataPointWithData?.variations
      ? Math.min(
          ...lastDataPointWithData.variations
            .filter((_, i) => showVariations[i])
            .map(
              (variation) =>
                variation?.ci?.[0] ??
                getYVal(variation ?? undefined, yaxis) ??
                0,
            ),
        )
      : 0;

    const latestMaxCI = lastDataPointWithData?.variations
      ? Math.max(
          ...lastDataPointWithData.variations
            .filter((_, i) => showVariations[i])
            .map(
              (variation) =>
                variation?.ci?.[1] ??
                getYVal(variation ?? undefined, yaxis) ??
                0,
            ),
        )
      : 0;

    // Calculate range based on latest data point (10x the range)
    const latestRange = Math.abs(latestMaxCI - latestMinCI);
    const expandedRange = latestRange * 10;
    const midpoint = (latestMaxCI + latestMinCI) / 2;
    const expandedMin = midpoint - expandedRange / 2;
    const expandedMax = midpoint + expandedRange / 2;

    const min = Math.min(
      minValue,
      latestMinCI,
      Math.max(expandedMin, minError),
    );
    const max = Math.max(
      maxValue,
      latestMaxCI,
      Math.min(expandedMax, maxError),
    );
    const range = max - min;
    const expandedRange2 = range * 1.05;
    const buffer = (expandedRange2 - range) / 2;
    return [min - buffer, max + buffer];
  }, [datapoints, yaxis, showVariations, sortedDatesWithData]);

  // Get x-axis domain
  const min = Math.min(...datapoints.map((d) => d.d.getTime()));
  const max = Math.max(...datapoints.map((d) => d.d.getTime()));

  const lastDataPointIndexWithHelperText = sortedDatesWithData.findLastIndex(
    (it) => it.helperText,
  );

  // If any point or variation has a valid CI we should render it
  const variationsWithCI = useMemo(() => {
    return variationNames.map((_, i) =>
      sortedDatesWithData.some((d) => d.variations?.[i]?.ci !== undefined),
    );
  }, [sortedDatesWithData, variationNames]);

  const hasDataForDay = useMemo(() => {
    const firstDateWithData =
      sortedDatesWithData[
        // Ensure we don't go past the end of the array
        Math.min(
          lastDataPointIndexWithHelperText + 1,
          sortedDatesWithData.length - 1,
        )
      ].d;
    const lastDateWithData =
      sortedDatesWithData[sortedDatesWithData.length - 1].d;

    return (d: Date | NumberValue) => {
      if (typeof d === "number") {
        d = new Date(d);
      }
      return d >= firstDateWithData && d <= lastDateWithData;
    };
  }, [lastDataPointIndexWithHelperText, sortedDatesWithData]);

  return (
    <ParentSizeModern>
      {({ width }) => {
        const yMax = Math.max(0, height - margin[0] - margin[2]);
        const xMax = Math.max(0, width - margin[1] - margin[3]);
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
            datapoints,
            yScale,
            xScale,
            yaxis,
          );
          if (!data?.y || data.y.every((v) => v === undefined)) {
            hideTooltip();
            return;
          }

          // Check if there are any non-control variations with data at this specific point
          const hasNonControlVariations = data.d.variations?.some((v, i) => {
            if (i === 0) return false; // Skip control for effect axis
            return showVariations[i] && v !== null && v !== undefined;
          });

          if (!hasNonControlVariations) {
            hideTooltip();
            return;
          }

          // const validYValues = data.y.filter(
          //   (v): v is number => v !== undefined
          // );
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
                className={timeSeriesStyles.tooltip}
                left={tooltipLeft}
                top={tooltipTop + margin[0]}
                unstyled={true}
              >
                <RadixTheme>
                  <div className={timeSeriesStyles.tooltipContent}>
                    {getTooltipContents(
                      tooltipData,
                      variationNames,
                      showVariations,
                      statsEngine,
                      usesPValueAdjustment,
                      formatter,
                      formatterOptions,
                      hasStats,
                    )}
                  </div>
                </RadixTheme>
              </TooltipInPortal>
            )}
            <div
              ref={containerRef}
              className={styles.dategraph}
              style={{
                width: Math.max(0, width - margin[1] - margin[3]),
                height: Math.max(0, height - margin[0] - margin[2]),
                marginLeft: margin[3],
                marginTop: margin[0],
              }}
              onPointerMove={handlePointer}
              onPointerLeave={hideTooltip}
            >
              {tooltipOpen && (
                <>
                  {variationNames.map((variationName, i) => {
                    if (!showVariations[i]) return null;
                    if (yaxis === "effect" && i === 0) {
                      return null;
                    }
                    if (!tooltipData?.d.variations?.[i]) return null;
                    // Render a dot at the current x location for each variation
                    return (
                      <div
                        key={`tooltip_dot_open_${i}`}
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

              {sortedDatesWithData.map((d) => {
                // Render a dot at the current x location for each variation
                return (
                  <React.Fragment key={`date_${d.d.getTime()}`}>
                    {variationNames.map((_, i) => {
                      if (yaxis === "effect" && i === 0) {
                        return null;
                      }
                      if (!showVariations[i]) return null;
                      const variation = d.variations?.[i];
                      if (!variation) return null;
                      return (
                        <div
                          key={`${d.d.getTime()}_${i}`}
                          className={timeSeriesStyles.positionWithData}
                          style={{
                            transform: `translate(${xScale(d.d)}px, ${
                              yScale(getYVal(variation, yaxis) ?? 0) ?? 0
                            }px)`,
                            background: getVariationColor(i, true),
                          }}
                        />
                      );
                    })}
                  </React.Fragment>
                );
              })}
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
                  stroke="var(--slate-a3)"
                />
                <GridColumns
                  scale={xScale}
                  stroke="var(--slate-a3)"
                  height={yMax}
                  numTicks={numXTicks}
                  tickValues={numXTicks < 7 ? allXTicks : undefined}
                />

                <Group clipPath="url(#experiment-date-graph-clip)">
                  {variationNames.map((_, i) => {
                    if (!showVariations[i]) return null;
                    if (yaxis === "effect" && i === 0) {
                      return (
                        <React.Fragment key={`empty_${i}`}></React.Fragment>
                      );
                    }

                    const sortedDataForVariation = sortedDatesWithData
                      .map((d) => ({
                        d: d.d,
                        variation: d.variations?.[i],
                        helperText: d.helperText,
                      }))
                      .filter(
                        (item) =>
                          item.variation !== null &&
                          item.variation !== undefined,
                      );

                    return (
                      variationsWithCI[i] && (
                        <AreaClosed
                          key={`ci_${i}`}
                          yScale={yScale}
                          data={sortedDataForVariation}
                          x={(d) => xScale(d.d) ?? 0}
                          y0={(d) => {
                            return yScale(d?.variation?.ci?.[0] ?? 0) ?? 0;
                          }}
                          y1={(d) => {
                            return yScale(d?.variation?.ci?.[1] ?? 0) ?? 0;
                          }}
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

                    // NB: We include the last index in both arrays as we need
                    // to draw the dashed line to it, and the solid line from it onwards
                    const sortedDataForVariation = sortedDatesWithData
                      .map((d) => ({
                        d: d.d,
                        variation: d.variations?.[i],
                        helperText: d.helperText,
                      }))
                      .filter(
                        (item) =>
                          item.variation !== null &&
                          item.variation !== undefined,
                      );

                    const previousSettingsDataPoints =
                      sortedDataForVariation.filter(
                        (_, idx) => idx <= lastDataPointIndexWithHelperText,
                      );
                    const currentSettingsDataPoints =
                      sortedDataForVariation.filter(
                        (_, idx) => idx >= lastDataPointIndexWithHelperText,
                      );

                    return (
                      <React.Fragment key={`linepaths_${i}`}>
                        {/* Render a dotted line for the previous settings data points */}
                        <LinePath
                          key={`linepath_dashed_${i}`}
                          data={previousSettingsDataPoints}
                          x={(d) => xScale(d.d)}
                          y={(d) => {
                            return yScale(
                              getYVal(d.variation ?? undefined, yaxis) ?? 0,
                            );
                          }}
                          stroke={getVariationColor(i, true)}
                          strokeWidth={2}
                          strokeDasharray={3}
                          strokeLinecap="butt"
                          curve={curveLinear}
                        />
                        {/* Render a solid line for the current settings data points */}
                        <LinePath
                          key={`linepath_solid_${i}`}
                          data={currentSettingsDataPoints}
                          x={(d) => xScale(d.d)}
                          y={(d) => {
                            return yScale(
                              getYVal(d.variation ?? undefined, yaxis) ?? 0,
                            );
                          }}
                          stroke={getVariationColor(i, true)}
                          strokeWidth={2}
                          curve={curveLinear}
                        />
                      </React.Fragment>
                    );
                  })}

                  <line
                    x1={0}
                    y1={yScale(0)}
                    x2={xMax}
                    y2={yScale(0)}
                    stroke="var(--slate-a7)"
                    strokeWidth={1}
                    strokeDasharray="6,4"
                    strokeLinecap="butt"
                  />
                </Group>

                <AxisBottom
                  top={yMax}
                  scale={xScale}
                  numTicks={numXTicks}
                  tickLabelProps={(d) => {
                    return {
                      fill: hasDataForDay(d)
                        ? "var(--color-text-high)"
                        : "var(--color-text-low)",
                      fontSize: 11,
                      textAnchor: "middle",
                    };
                  }}
                  tickFormat={(d, i, values) => {
                    const date = getValidDate(
                      d instanceof Date ? d : d.valueOf(),
                    );
                    const now = new Date();
                    const sixMonthsAgo = new Date(
                      now.getFullYear(),
                      now.getMonth() - 6,
                      now.getDate(),
                    );
                    const isOldRange = min < sixMonthsAgo.getTime();

                    if (isOldRange) {
                      // Check if this tick is on Jan 1st
                      const isJan1 =
                        date.getMonth() === 0 && date.getDate() === 1;
                      if (isJan1) {
                        return format(date, "MMM d, yyyy");
                      }

                      // Check if this is the first tick and it's 1+ months older than oldest Jan 1st tick
                      if (i === 0) {
                        // Find the oldest Jan 1st tick in the data range
                        const jan1Ticks = values.filter((tick) => {
                          const tickDate = getValidDate(
                            tick.value instanceof Date
                              ? tick.value
                              : tick.value.valueOf(),
                          );
                          return (
                            tickDate.getMonth() === 0 &&
                            tickDate.getDate() === 1
                          );
                        });

                        if (jan1Ticks.length === 0) {
                          // No Jan 1st tick exists, show year on first tick
                          return format(date, "MMM d, yyyy");
                        } else {
                          // Show year if first tick is 1+ months older than oldest Jan 1st tick
                          const oldestJan1Tick = Math.min(
                            ...jan1Ticks.map((tick) => {
                              const tickDate = getValidDate(
                                tick.value instanceof Date
                                  ? tick.value
                                  : tick.value.valueOf(),
                              );
                              return tickDate.getTime();
                            }),
                          );
                          const monthsDiff = Math.abs(
                            (date.getFullYear() -
                              new Date(oldestJan1Tick).getFullYear()) *
                              12 +
                              (date.getMonth() -
                                new Date(oldestJan1Tick).getMonth()),
                          );
                          if (monthsDiff >= 1) {
                            return format(date, "MMM d, yyyy");
                          }
                        }
                      }
                    }

                    return format(date, "MMM d");
                  }}
                  tickValues={numXTicks < 7 ? allXTicks : undefined}
                  axisLineClassName={timeSeriesStyles.axisLine}
                  tickLineProps={{
                    stroke: "var(--slate-a3)",
                  }}
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
                    verticalAnchor: "middle",
                  })}
                  label={label}
                  labelProps={{
                    fill: "var(--color-text-mid)",
                    textAnchor: "middle",
                  }}
                  labelClassName="h5"
                  axisLineClassName={timeSeriesStyles.axisLine}
                  tickLineProps={{
                    stroke: "var(--slate-a3)",
                  }}
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
