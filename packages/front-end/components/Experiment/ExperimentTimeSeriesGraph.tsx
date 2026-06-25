import React, { FC, useMemo } from "react";
import { format } from "date-fns";
import { ParentSizeModern } from "@visx/responsive";
import { Group } from "@visx/group";
import { Box, Flex, Text } from "@radix-ui/themes";
import { GridColumns, GridRows } from "@visx/grid";
import { scaleLinear, scaleTime } from "@visx/scale";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { AreaClosed, LinePath } from "@visx/shape";
import { curveLinear } from "@visx/curve";
import { useTooltip, useTooltipInPortal } from "@visx/tooltip";
import { datetime, getValidDate } from "shared/dates";
import { StatsEngine } from "shared/types/stats";
import cloneDeep from "lodash/cloneDeep";
import { NumberValue, ScaleLinear, ScaleTime } from "d3-scale";
import { pValueFormatter } from "@/services/experiments";
import { getVariationColor } from "@/services/features";
import { RadixTheme } from "@/services/RadixTheme";
import HelperText from "@/ui/HelperText";
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
  // Synthetic pre-rollout anchor: keeps the line/area shaped from the experiment
  // start, but renders no dot and shows no tooltip (it isn't a real measurement).
  isPaddingPoint?: boolean;
}

import { GraphVariation } from "./ExperimentDateGraph";

export interface ExperimentTimeSeriesGraphProps {
  yaxis: AxisType;
  variations: GraphVariation[];
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
  // When true the CI is one-sided (one bound is ±Infinity). The y-range is
  // anchored at 0 + padding around the finite bound/point estimates instead of
  // expanding off the fake bound, and the ribbon fills out to the plot edge.
  oneSided?: boolean;
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

function renderCiTooltipCell(
  ci: [number, number] | undefined,
  formatter: (value: number, options?: Intl.NumberFormatOptions) => string,
  formatterOptions?: Intl.NumberFormatOptions,
): React.ReactNode {
  if (!ci) return "—";
  const [lo, hi] = ci;
  const loF = Number.isFinite(lo);
  const hiF = Number.isFinite(hi);
  if (loF && hiF) {
    return (
      <Text as="span" weight="bold">
        [{formatter(lo, formatterOptions)}, {formatter(hi, formatterOptions)}]
      </Text>
    );
  }
  if (!loF && hiF) {
    return (
      <>
        <Text as="span" weight="bold">
          {formatter(hi, formatterOptions)}
        </Text>
        <Text as="span" size="1" color="gray">
          {" "}
          (upper)
        </Text>
      </>
    );
  }
  if (loF && !hiF) {
    return (
      <>
        <Text as="span" weight="bold">
          {formatter(lo, formatterOptions)}
        </Text>
        <Text as="span" size="1" color="gray">
          {" "}
          (lower)
        </Text>
      </>
    );
  }
  return "—";
}

// Render the contents of a tooltip
const getTooltipContents = (
  data: TooltipData,
  variations: GraphVariation[],
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

  const hasOneSidedCiInTooltip = d.variations?.some(
    (v, i) =>
      i > 0 &&
      !!v?.ci &&
      (!Number.isFinite(v.ci[0]) || !Number.isFinite(v.ci[1])),
  );

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
                  {hasOneSidedCiInTooltip ? "95% CI" : "CI"}
                  {showAdjustmentNote ? "*" : null}
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
          {variations.map((v, i) => {
            if (!d.variations) return null;
            if (!showVariations[i]) return null;
            const variation = d.variations[i];
            if (!variation) return null;
            const variationColor = getVariationColor(v.index, true);
            return (
              <TableRow
                key={`tooltip_row_${v.index}`}
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
                      {v.index}
                    </span>
                    <Text weight="bold">{v.name}</Text>
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
                          {i > 0 &&
                            renderCiTooltipCell(
                              variation?.ci,
                              formatter,
                              formatterOptions,
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
          <Text size="1" my="2">
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

/** Non-finite CI bounds must not expand the y-axis; use the point for domain math only. */
function finiteCiForDomain(bound: number | undefined, point: number): number {
  if (bound === undefined) return point;
  if (Number.isFinite(bound)) return bound;
  return point;
}

/** Map open CI bound to plot edge in **data** space (current y domain), for ribbon fill only. */
function ciLowerForArea(
  lo: number | undefined,
  point: number,
  yDomainMin: number,
): number {
  if (lo === undefined) return point;
  if (Number.isFinite(lo)) return lo;
  if (lo === Number.NEGATIVE_INFINITY) return yDomainMin;
  return point;
}

function ciUpperForArea(
  hi: number | undefined,
  point: number,
  yDomainMax: number,
): number {
  if (hi === undefined) return point;
  if (Number.isFinite(hi)) return hi;
  if (hi === Number.POSITIVE_INFINITY) return yDomainMax;
  return point;
}

const ExperimentTimeSeriesGraph: FC<ExperimentTimeSeriesGraphProps> = ({
  yaxis,
  datapoints: _datapoints,
  variations,
  label,
  formatter,
  formatterOptions,
  showVariations,
  statsEngine,
  usesPValueAdjustment,
  hasStats = true,
  maxGapHours = 36,
  cumulative = false,
  oneSided = false,
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
    if (oneSided) {
      // One-sided CI: build the range from the *real* values only — finite CI
      // bounds and point estimates — plus 0 as a reference. The fake
      // (±Infinity) bound is ignored; the ribbon is filled out to the plot
      // edge by ciLowerForArea/ciUpperForArea. Because we take min/max, 0 only
      // widens the range when it is the extreme; a CI that straddles 0 keeps
      // its real bounds.
      const vals: number[] = [0];
      datapoints.forEach((d) => {
        d?.variations?.forEach((variation, i) => {
          if (!showVariations[i]) return;
          const pt = getYVal(variation ?? undefined, yaxis);
          if (pt !== undefined) vals.push(pt);
          const lo = variation?.ci?.[0];
          const hi = variation?.ci?.[1];
          if (lo !== undefined && Number.isFinite(lo)) vals.push(lo);
          if (hi !== undefined && Number.isFinite(hi)) vals.push(hi);
        });
      });
      const rawMin = Math.min(...vals);
      const rawMax = Math.max(...vals);
      const range = Math.max(rawMax - rawMin, 0.001);
      const buffer = range * 0.05;
      const paddedMin = rawMin - buffer;
      const paddedMax = rawMax + buffer;
      const minHalfWidthAboutZero = Math.max(
        0.001,
        ((paddedMax - paddedMin) / 2) * 0.02,
      );
      return [
        Math.min(paddedMin, -minHalfWidthAboutZero),
        Math.max(paddedMax, minHalfWidthAboutZero),
      ];
    }
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
                  finiteCiForDomain(
                    variation?.ci?.[0],
                    getYVal(variation ?? undefined, yaxis) ?? 0,
                  ),
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
                  finiteCiForDomain(
                    variation?.ci?.[1],
                    getYVal(variation ?? undefined, yaxis) ?? 0,
                  ),
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
            .map((variation) =>
              finiteCiForDomain(
                variation?.ci?.[0],
                getYVal(variation ?? undefined, yaxis) ?? 0,
              ),
            ),
        )
      : 0;

    const latestMaxCI = lastDataPointWithData?.variations
      ? Math.max(
          ...lastDataPointWithData.variations
            .filter((_, i) => showVariations[i])
            .map((variation) =>
              finiteCiForDomain(
                variation?.ci?.[1],
                getYVal(variation ?? undefined, yaxis) ?? 0,
              ),
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
    const paddedMin = min - buffer;
    const paddedMax = max + buffer;
    const halfSpan = (paddedMax - paddedMin) / 2;
    // Keep the y=0 reference inside the domain with a minimum margin on each side.
    const minHalfWidthAboutZero = Math.max(0.001, halfSpan * 0.02);
    return [
      Math.min(paddedMin, -minHalfWidthAboutZero),
      Math.max(paddedMax, minHalfWidthAboutZero),
    ];
  }, [datapoints, yaxis, showVariations, sortedDatesWithData, oneSided]);

  // Get x-axis domain
  const min = Math.min(...datapoints.map((d) => d.d.getTime()));
  const max = Math.max(...datapoints.map((d) => d.d.getTime()));

  const lastDataPointIndexWithHelperText = sortedDatesWithData.findLastIndex(
    (it) => it.helperText,
  );

  // If any point or variation has a valid CI we should render it
  const variationsWithCI = useMemo(() => {
    return variations.map((_, i) =>
      sortedDatesWithData.some((d) => d.variations?.[i]?.ci !== undefined),
    );
  }, [sortedDatesWithData, variations]);

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

          // Padding points are synthetic anchors, not real measurements
          if (data.d.isPaddingPoint) {
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
                      variations,
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
                  {variations.map((v, i) => {
                    if (!showVariations[i]) return null;
                    if (yaxis === "effect" && i === 0) {
                      return null;
                    }
                    if (!tooltipData?.d.variations?.[i]) return null;
                    return (
                      <div
                        key={`tooltip_dot_open_${v.index}`}
                        className={styles.positionIndicator}
                        style={{
                          transform: `translate(${tooltipLeft}px, ${
                            tooltipData?.y?.[i] ?? 0
                          }px)`,
                          background: getVariationColor(v.index, true),
                        }}
                      />
                    );
                  })}
                </>
              )}

              {sortedDatesWithData.map((d) => {
                // Padding points shape the line but should render no dot
                if (d.isPaddingPoint) return null;
                // Render a dot at the current x location for each variation
                return (
                  <React.Fragment key={`date_${d.d.getTime()}`}>
                    {variations.map((v, i) => {
                      if (yaxis === "effect" && i === 0) {
                        return null;
                      }
                      if (!showVariations[i]) return null;
                      const variation = d.variations?.[i];
                      if (!variation) return null;
                      return (
                        <div
                          key={`${d.d.getTime()}_${v.index}`}
                          className={timeSeriesStyles.positionWithData}
                          style={{
                            transform: `translate(${xScale(d.d)}px, ${
                              yScale(getYVal(variation, yaxis) ?? 0) ?? 0
                            }px)`,
                            background: getVariationColor(v.index, true),
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
                  {variations.map((v, i) => {
                    if (!showVariations[i]) return null;
                    if (yaxis === "effect" && i === 0) {
                      return (
                        <React.Fragment
                          key={`empty_${v.index}`}
                        ></React.Fragment>
                      );
                    }

                    const sortedDataForVariation = sortedDatesWithData
                      .filter((d) => !d.isPaddingPoint)
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
                          key={`ci_${v.index}`}
                          yScale={yScale}
                          data={sortedDataForVariation}
                          x={(d) => xScale(d.d) ?? 0}
                          y0={(d) => {
                            const pt =
                              getYVal(d.variation ?? undefined, yaxis) ?? 0;
                            const [yMin, yMax] = yScale.domain();
                            const loData = ciLowerForArea(
                              d.variation?.ci?.[0],
                              pt,
                              yMin,
                            );
                            const hiData = ciUpperForArea(
                              d.variation?.ci?.[1],
                              pt,
                              yMax,
                            );
                            const yLo = yScale(loData) ?? 0;
                            const yHi = yScale(hiData) ?? 0;
                            return Math.max(yLo, yHi);
                          }}
                          y1={(d) => {
                            const pt =
                              getYVal(d.variation ?? undefined, yaxis) ?? 0;
                            const [yMin, yMax] = yScale.domain();
                            const loData = ciLowerForArea(
                              d.variation?.ci?.[0],
                              pt,
                              yMin,
                            );
                            const hiData = ciUpperForArea(
                              d.variation?.ci?.[1],
                              pt,
                              yMax,
                            );
                            const yLo = yScale(loData) ?? 0;
                            const yHi = yScale(hiData) ?? 0;
                            return Math.min(yLo, yHi);
                          }}
                          fill={getVariationColor(v.index, true)}
                          opacity={0.12}
                          // curveMonotoneX is invalid for d3 areas: the y0 boundary is traced
                          // with decreasing x, which breaks monotone-X splines and collapses the fill.
                          curve={curveLinear}
                        />
                      )
                    );
                  })}

                  {variations.map((v, i) => {
                    if (!showVariations[i]) return null;
                    if (yaxis === "effect" && i === 0) {
                      return null;
                    }

                    const sortedDataForVariation = sortedDatesWithData
                      .filter((d) => !d.isPaddingPoint)
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
                      <React.Fragment key={`linepaths_${v.index}`}>
                        <LinePath
                          key={`linepath_dashed_${v.index}`}
                          data={previousSettingsDataPoints}
                          x={(d) => xScale(d.d)}
                          y={(d) => {
                            return yScale(
                              getYVal(d.variation ?? undefined, yaxis) ?? 0,
                            );
                          }}
                          stroke={getVariationColor(v.index, true)}
                          strokeWidth={2}
                          strokeDasharray={3}
                          strokeLinecap="butt"
                          curve={curveLinear}
                        />
                        <LinePath
                          key={`linepath_solid_${v.index}`}
                          data={currentSettingsDataPoints}
                          x={(d) => xScale(d.d)}
                          y={(d) => {
                            return yScale(
                              getYVal(d.variation ?? undefined, yaxis) ?? 0,
                            );
                          }}
                          stroke={getVariationColor(v.index, true)}
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
