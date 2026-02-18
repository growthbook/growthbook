import React, { useMemo } from "react";
import { Group } from "@visx/group";
import { BarRounded, BarStack } from "@visx/shape";
import { scaleBand, scaleLinear, scaleOrdinal } from "@visx/scale";
import { ParentSize } from "@visx/responsive";
import { ComputedExperimentInterface } from "shared/types/experiment";
import { green, red, amber, slate } from "@radix-ui/colors";
import { Box, Flex, Heading } from "@radix-ui/themes";
import { localPoint } from "@visx/event";
import { TooltipWithBounds, useTooltip } from "@visx/tooltip";
import format from "date-fns/format";
import { GridRows } from "@visx/grid";
import { AxisBottom, AxisLeft } from "@visx/axis";
import styles from "@/components/Experiment/ExperimentGraph.module.scss";

export default function ExecExperimentsGraph({
  experiments,
  startDate,
  endDate,
}: {
  selectedProjects?: string[];
  experiments: ComputedExperimentInterface[];
  dateRange: string;
  startDate: Date;
  endDate: Date;
}) {
  const {
    showTooltip,
    hideTooltip,
    tooltipOpen,
    tooltipData,
    tooltipLeft = 0,
    tooltipTop = 0,
  } = useTooltip<Record<string, number | string>>();
  const groupedData = useMemo(() => {
    const data = { won: 0, lost: 0, inconclusive: 0, dnf: 0 };
    const monthlyData: Record<
      string,
      { won: number; lost: number; inconclusive: number; dnf: number }
    > = {};

    // create an empty object for each month in the range
    if (startDate && endDate) {
      const startMonth = new Date(
        startDate.getFullYear(),
        startDate.getMonth(),
      );
      const endMonth = new Date(endDate.getFullYear(), endDate.getMonth());
      const currentMonth = new Date(startMonth);

      while (currentMonth <= endMonth) {
        const monthKey = `${currentMonth.getFullYear()}-${
          currentMonth.getMonth() + 1
        }`;
        monthlyData[monthKey] = { won: 0, lost: 0, inconclusive: 0, dnf: 0 };
        currentMonth.setMonth(currentMonth.getMonth() + 1);
      }
    }

    experiments.forEach((experiment) => {
      const status = experiment.results || "inconclusive";
      // first, find the last phase that is marked as "Main"
      let usedPhase = experiment.phases
        .filter((p) => p.name === "Main")
        .sort((a, b) => {
          return (
            new Date(b.dateEnded || 0).getTime() -
            new Date(a.dateEnded || 0).getTime()
          );
        })[0];
      // second, if there is no "Main" phase, use the last phase
      if (!usedPhase) {
        usedPhase = experiment.phases.sort((a, b) => {
          return (
            new Date(b.dateEnded || 0).getTime() -
            new Date(a.dateEnded || 0).getTime()
          );
        })[0];
      }

      const endDate = new Date(usedPhase?.dateEnded || 0);
      const monthKey = `${endDate.getFullYear()}-${endDate.getMonth() + 1}`;

      if (monthlyData[monthKey]) {
        monthlyData[monthKey][status] =
          (monthlyData[monthKey][status] || 0) + 1;
      }
    });

    return { data, monthlyData };
  }, [experiments, endDate, startDate]);

  const chartDataMonthly = useMemo(() => {
    const chartData = Object.entries(groupedData.monthlyData).map(
      ([key, values]) => ({
        label: key,
        total: Object.values(values).reduce((a, b) => a + b, 0),
        ...values,
      }),
    );

    return chartData;
  }, [groupedData]);

  const height = 240;
  const margin = { top: 20, right: 40, bottom: 20, left: 40 };
  const colors = {
    won: green.green8,
    lost: red.red7,
    inconclusive: slate.slate6,
    dnf: amber.amber5,
  };

  const keys = ["won", "lost", "inconclusive", "dnf"];

  const legend = (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        marginTop: "10px",
      }}
    >
      {keys.map((key) => (
        <div
          key={key}
          style={{
            display: "flex",
            alignItems: "center",
            marginRight: "15px",
          }}
        >
          <div
            style={{
              width: "12px",
              height: "12px",
              borderRadius: "50%",
              backgroundColor: colors[key],
              marginRight: "5px",
            }}
          ></div>
          <span style={{ fontSize: "12px", color: "var(--slate-12)" }}>
            {key}
          </span>
        </div>
      ))}
    </div>
  );

  return (
    <Flex
      align="center"
      justify="center"
      style={{ width: "100%", height: "100%" }}
    >
      <Box flexGrow="1">
        <Heading size="3">Experiment Status</Heading>
        <ParentSize>
          {({ width }) => {
            // Vertical Stacked Bar Graph
            const yMax = height - margin.top - margin.bottom;
            const xMax = width - margin.right - margin.left;
            const maxYValue = Math.ceil(
              Math.max(...chartDataMonthly.map((d) => d.total), 1),
            );

            const xScale = scaleBand({
              domain: chartDataMonthly.map((d) => {
                return d.label;
              }),
              range: [0, xMax],
              round: true,
              align: 0.5,
              paddingInner: 0.15,
              paddingOuter: 0.1,
            });

            const yScale = scaleLinear<number>({
              domain: [0, maxYValue],
              range: [yMax, 0],
              round: true,
            });

            const colorScale = scaleOrdinal({
              domain: keys,
              range: Object.values(colors),
            });

            const handlePointer = (event: React.MouseEvent<SVGElement>) => {
              const coords = localPoint(event);
              const xCoord =
                (coords?.x ?? 0) - xScale.bandwidth() / 2 - margin.left;
              const barData = chartDataMonthly.map((d) => {
                return {
                  raw: { ...d },
                  xcord: xScale(d.label),
                  numExp: d.total,
                };
              });
              const closestBar = barData.reduce((prev, curr) =>
                Math.abs((curr?.xcord ?? 0) - xCoord) <
                Math.abs((prev?.xcord ?? 0) - xCoord)
                  ? curr
                  : prev,
              );

              showTooltip({
                tooltipTop: keys.length * 20 * -1, //<- estimate the rough number of lines we're going to show
                tooltipLeft: closestBar.xcord,
                tooltipData: closestBar.raw,
              });
            };

            // monthly stacked bar graph:
            return (
              <>
                <Box
                  onMouseLeave={() => {
                    window.setTimeout(() => {
                      hideTooltip();
                    }, 100);
                  }}
                >
                  <div style={{ position: "relative" }}>
                    {tooltipOpen && (
                      <TooltipWithBounds
                        left={tooltipLeft}
                        top={tooltipTop}
                        className={styles.tooltiplg}
                        unstyled={true}
                      >
                        <>
                          <>
                            <h4 className={`mb-1 ${styles.tooltipHeader}`}>
                              {format(
                                new Date(
                                  parseInt(
                                    tooltipData?.label
                                      ?.toString()
                                      .split("-")[0] || "0",
                                  ),
                                  parseInt(
                                    tooltipData?.label
                                      ?.toString()
                                      .split("-")[1] || "0",
                                  ) - 1, // Month keys are 1-indexed, Date constructor expects 0-indexed
                                ),
                                "LLL yyyy",
                              )}
                            </h4>
                            {keys.map((k) => (
                              <div key={k} className={styles.tooltipRow}>
                                <div className={styles.tooltipName}>{k}</div>
                                <div className={styles.tooltipValue}>
                                  {tooltipData?.[k] ?? 0}
                                </div>
                              </div>
                            ))}
                          </>
                        </>
                      </TooltipWithBounds>
                    )}
                  </div>
                  <svg
                    width={width}
                    height={height}
                    onMouseMove={handlePointer}
                  >
                    <Group left={margin.left} top={margin.top}>
                      <GridRows
                        scale={yScale}
                        numTicks={Math.min(maxYValue, 5)}
                        width={xMax}
                        stroke="var(--border-color-200)"
                      />
                      <BarStack
                        data={chartDataMonthly}
                        keys={keys}
                        x={(d) => d.label}
                        xScale={xScale}
                        yScale={yScale}
                        color={colorScale}
                        radius={6}
                      >
                        {(barStacks) => {
                          // each barStack is a group of bars for a given key
                          // since we are stacking by date, we need to find index of the top bar for each date
                          // and show that one as rounded
                          const topBarsIndex = {};
                          barStacks.map((barStack) => {
                            barStack.bars.forEach((bar, i) => {
                              if (bar.height > 0) {
                                topBarsIndex[i] = bar.key;
                              }
                            });
                          });

                          return barStacks.map((barStack) => {
                            return barStack.bars.map((bar, i) => {
                              const barHeight = Math.max(bar.height, 0);
                              // if there are no experiments this month, show a little nub for design reasons. - this is not working as the topBarsIndex will not be set for this column.

                              if (topBarsIndex?.[i] === bar.key) {
                                return (
                                  <BarRounded
                                    key={`bar-${bar.index}-${bar.key}`}
                                    x={bar.x}
                                    y={bar.y}
                                    height={barHeight}
                                    width={bar.width}
                                    fill={bar.color}
                                    top
                                    radius={6}
                                    className={styles.barHovStacked}
                                  />
                                );
                              }
                              return (
                                <rect
                                  key={`bar-${bar.index}-${bar.key}`}
                                  x={bar.x}
                                  y={bar.y}
                                  height={Math.max(bar.height, 0)}
                                  width={bar.width}
                                  fill={bar.color}
                                  className={styles.barHovStacked}
                                />
                              );
                            });
                          });
                        }}
                      </BarStack>
                      <AxisBottom
                        top={yMax}
                        scale={xScale}
                        numTicks={
                          chartDataMonthly.length > 5
                            ? 5
                            : chartDataMonthly.length
                        }
                        tickLabelProps={() => ({
                          fill: "var(--text-color-table)",
                          fontSize: 11,
                          textAnchor: "middle",
                        })}
                        hideAxisLine={false}
                        stroke={"var(--text-color-table)"}
                        hideTicks={true}
                        rangePadding={0}
                        tickFormat={(d) => {
                          return format(
                            new Date(
                              parseInt(d.split("-")[0]),
                              parseInt(d.split("-")[1]) - 1, // Month keys are 1-indexed, Date constructor expects 0-indexed
                            ),
                            "LLL yyyy",
                          );
                        }}
                      />
                      <AxisLeft
                        scale={yScale}
                        numTicks={Math.min(maxYValue, 5)}
                        tickLabelProps={() => ({
                          fill: "var(--text-color-table)",
                          fontSize: 11,
                          textAnchor: "end",
                          dx: -2,
                          dy: 2,
                        })}
                        stroke="var(--slate-9)"
                        hideTicks={true}
                        tickFormat={(v) => {
                          return Math.round(v as number) + "";
                        }}
                      />
                    </Group>
                  </svg>
                  {legend}
                </Box>
              </>
            );
          }}
        </ParentSize>
      </Box>
    </Flex>
  );
}
