import { scaleBand, scaleTime } from "@visx/scale";
import { Group } from "@visx/group";
import { AxisTop } from "@visx/axis";
import {
  ExperimentInterfaceStringDates,
  ExperimentPhaseStringDates,
  ExperimentStatus,
} from "back-end/types/experiment";
import { getValidDate, date } from "shared/dates";
import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Box, Flex, Text } from "@radix-ui/themes";
import {
  TooltipWithBounds,
  useTooltip,
  defaultStyles as tooltipDefaultStyles,
} from "@visx/tooltip";
import { format } from "date-fns";
import { GridColumns } from "@visx/grid";
import styles from "@/components/Metrics/DateGraph.module.scss";
import { formatPercent } from "@/services/metrics";
import EmptyState from "@/components/EmptyState";

const margin = { top: 30, right: 60, bottom: 30, left: 200 }; // Increased right margin to prevent end tick cutoff

const getPhaseColor = (
  experiment: ExperimentInterfaceStringDates,
  phase: "running" | "won"
) => {
  // Simplified color scheme matching the image
  const mainColor =
    phase === "running" ? "blue" : phase === "won" ? "green" : "blue"; // Default to blue for other statuses

  return {
    background: `var(--${mainColor}-5)`,
    borderColor: `var(--${mainColor}-6)`,
    text: `var(--gray-1)`,
  };
};
const HoldoutTimeline: React.FC<{
  experiments: ExperimentInterfaceStringDates[];
  startDate?: Date;
  endDate?: Date;
}> = ({
  experiments,
  startDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 7),
  endDate = new Date(),
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipTimeout = useRef<NodeJS.Timeout | null>(null);

  // we need to filter the experiments to only those that have phases within the selected date range:
  const filteredExperiments = useMemo(() => {
    return experiments.filter((experiment) => {
      return experiment.phases.some((phase) => {
        const start = getValidDate(phase.dateStarted);
        const end =
          experiment.status === "stopped"
            ? getValidDate(phase.dateEnded)
            : new Date();
        return (
          (start && start >= startDate && start <= endDate) ||
          (end && end >= startDate && end <= endDate)
        );
      });
    });
  }, [endDate, experiments, startDate]);

  const [width, setWidth] = useState(800); // Default width
  const rowHeight = 50; // Much taller rows to match the image design
  const height =
    margin.top + margin.bottom + filteredExperiments.length * rowHeight;

  const {
    showTooltip,
    hideTooltip,
    tooltipOpen,
    tooltipData,
    tooltipLeft = 0,
    tooltipTop = 0,
  } = useTooltip<{
    experimentName: string;
    status: ExperimentStatus;
    result: string;
    phase: ExperimentPhaseStringDates;
  }>();

  const handleBarMouseMove = (
    event: React.MouseEvent<SVGRectElement>,
    experimentName: string,
    status: ExperimentStatus,
    result: string,
    phase: ExperimentPhaseStringDates
  ) => {
    if (!containerRef.current) return;

    const containerRect = containerRef.current.getBoundingClientRect();
    const rect = event.currentTarget.getBoundingClientRect();

    // Calculate tooltip position relative to the container
    let tooltipLeft = event.clientX - containerRect.left;
    let tooltipTop = rect.top - containerRect.top - 10;

    // Ensure tooltip stays within container bounds
    const tooltipWidth = 200; // Approximate tooltip width

    if (tooltipLeft + tooltipWidth > containerRect.width) {
      tooltipLeft = event.clientX - containerRect.left - tooltipWidth;
    }

    if (tooltipTop < 0) {
      tooltipTop = rect.bottom - containerRect.top + 10;
    }

    // Clear any existing timeout
    if (tooltipTimeout.current) {
      clearTimeout(tooltipTimeout.current);
    }

    // Set a timeout to show the tooltip
    tooltipTimeout.current = setTimeout(() => {
      showTooltip({
        tooltipLeft,
        tooltipTop,
        tooltipData: { experimentName, status, result, phase },
      });
    }, 150); // 150ms delay
  };

  const handleBarMouseLeave = () => {
    // Clear the timeout and hide the tooltip with a small delay to prevent flickering
    if (tooltipTimeout.current) {
      clearTimeout(tooltipTimeout.current);
    }

    // Add a small delay before hiding to prevent flickering when moving between elements
    tooltipTimeout.current = setTimeout(() => {
      hideTooltip();
    }, 50);
  };

  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current) {
        setWidth(containerRef.current.offsetWidth);
      }
    };

    handleResize(); // Set initial width
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      // Clear any pending tooltip timeout
      if (tooltipTimeout.current) {
        clearTimeout(tooltipTimeout.current);
      }
    };
  }, []);

  // Scales
  const xScale = scaleTime({
    domain: [startDate, endDate],
    range: [margin.left, width - margin.right],
  });
  const yScale = scaleBand({
    domain: filteredExperiments.map((e) => e.name),
    range: [margin.top, height - margin.bottom],
    padding: 0.05, // Minimal padding for tighter spacing
  });

  return (
    <Box>
      {experiments.length === 0 ? (
        <EmptyState
          title="No experiments found"
          description="No experiments match your search criteria. Try adjusting your filters."
          rightButton={null}
          leftButton={null}
        />
      ) : (
        <Box ref={containerRef} style={{ position: "relative", width: "100%" }}>
          {/* Fixed experiment names on the left */}
          <Box
            style={{
              position: "absolute",
              left: 0,
              top: margin.top,
              width: margin.left,
              height: height - margin.top - margin.bottom,
            }}
          >
            {filteredExperiments.map((experiment, i) => (
              <Box
                key={`name-${experiment.id}`}
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  top:
                    (yScale(experiment.name) ?? 0) -
                    margin.top -
                    (yScale.paddingOuter() * yScale.bandwidth()) / 2,
                  height:
                    yScale.bandwidth() +
                    yScale.paddingOuter() * yScale.bandwidth(),
                  display: "flex",
                  alignItems: "center",
                  padding: "0 12px",
                  backgroundColor:
                    i % 2 === 0 ? "var(--gray-2)" : "transparent",
                }}
              >
                <Text
                  size="2"
                  weight="medium"
                  style={{
                    color: "var(--gray-12)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    width: "100%",
                  }}
                >
                  <Link
                    href={`/experiment/${experiment.id}`}
                    style={{
                      color: "var(--gray-12)",
                      textDecoration: "none",
                    }}
                  >
                    {experiment.name}
                  </Link>
                </Text>
              </Box>
            ))}
          </Box>
          {tooltipOpen && tooltipData && (
            <TooltipWithBounds
              left={tooltipLeft}
              top={tooltipTop}
              className={styles.tooltip}
              style={{
                ...tooltipDefaultStyles,
                position: "absolute",
                zIndex: 1000,
                pointerEvents: "none",
                backgroundColor: "var(--gray-1)",
                border: "1px solid var(--gray-6)",
                borderRadius: "6px",
                padding: "12px",
                boxShadow: "0 4px 12px rgba(0, 0, 0, 0.1)",
                maxWidth: "280px",
              }}
            >
              <Flex direction="column" gap="2">
                <Text size="3" weight="bold">
                  {tooltipData.experimentName}
                </Text>
                <Flex direction="column" gap="1">
                  <Flex justify="between">
                    <Text size="2" color="gray">
                      Status:
                    </Text>
                    <Text size="2">{tooltipData.status}</Text>
                  </Flex>
                  {tooltipData.result && (
                    <Flex justify="between">
                      <Text size="2" color="gray">
                        Result:
                      </Text>
                      <Text size="2">{tooltipData.result}</Text>
                    </Flex>
                  )}
                  <Flex justify="between">
                    <Text size="2" color="gray">
                      Phase:
                    </Text>
                    <Text size="2">{tooltipData.phase.name}</Text>
                  </Flex>
                  <Flex justify="between">
                    <Text size="2" color="gray">
                      Coverage:
                    </Text>
                    <Text size="2">
                      {formatPercent(tooltipData.phase.coverage)}
                    </Text>
                  </Flex>
                  <Flex justify="between">
                    <Text size="2" color="gray">
                      Started:
                    </Text>
                    <Text size="2">
                      {tooltipData.phase.dateStarted
                        ? date(tooltipData.phase.dateStarted)
                        : "-"}
                    </Text>
                  </Flex>
                  {tooltipData.status === "stopped" && (
                    <Flex justify="between">
                      <Text size="2" color="gray">
                        Ended:
                      </Text>
                      <Text size="2">
                        {tooltipData.phase.dateEnded
                          ? date(tooltipData.phase.dateEnded)
                          : "-"}
                      </Text>
                    </Flex>
                  )}
                </Flex>
              </Flex>
            </TooltipWithBounds>
          )}
          <svg width={width} height={height}>
            <rect width={width} height={height} fill="none" />
            <Group>
              <GridColumns
                top={margin.top}
                left={margin.left}
                scale={xScale}
                width={width - margin.left - margin.right}
                height={height - margin.top - margin.bottom}
                stroke="transparent"
                strokeDasharray="1,1"
                strokeWidth={0.5}
              />

              {/* X-Axis at the top */}
              <AxisTop
                top={margin.top}
                scale={xScale}
                tickFormat={(d) => {
                  if (d instanceof Date) {
                    const rangeInDays =
                      (endDate.getTime() - startDate.getTime()) /
                      (1000 * 60 * 60 * 24);

                    if (rangeInDays < 7) {
                      // Less than a week - show day format
                      return format(d, "MMM d");
                    } else if (rangeInDays < 30) {
                      // Less than a month - show week format (Monday)
                      return format(d, "MMM d");
                    } else {
                      // More than a month - show month format
                      return format(d, "MMM yyyy");
                    }
                  }
                  return "-";
                }}
                tickValues={(() => {
                  const ticks: Date[] = [];
                  const current = new Date(startDate);
                  const end = new Date(endDate);
                  const rangeInDays =
                    (end.getTime() - startDate.getTime()) /
                    (1000 * 60 * 60 * 24);

                  // Add start date
                  ticks.push(new Date(startDate));

                  if (rangeInDays < 7) {
                    // Less than a week - show days starting from start date
                    // Only add first day if it's at least 12 hours (half a day) from start
                    const firstDay = new Date(startDate);
                    firstDay.setDate(firstDay.getDate() + 1);
                    if (
                      firstDay.getTime() - startDate.getTime() >=
                      12 * 60 * 60 * 1000
                    ) {
                      ticks.push(new Date(firstDay));
                    }

                    current.setTime(firstDay.getTime());
                    current.setDate(current.getDate() + 1);
                    while (current <= end) {
                      if (current.getTime() !== endDate.getTime()) {
                        ticks.push(new Date(current));
                      }
                      current.setDate(current.getDate() + 1);
                    }
                  } else if (rangeInDays < 30) {
                    // Less than a month - show week boundaries (Mondays)
                    // Find the next Monday from start date
                    const nextMonday = new Date(startDate);
                    const daysUntilMonday = (8 - nextMonday.getDay()) % 7;
                    if (daysUntilMonday > 0) {
                      nextMonday.setDate(
                        nextMonday.getDate() + daysUntilMonday
                      );
                    }

                    current.setTime(nextMonday.getTime());
                    while (current <= end) {
                      if (
                        current.getTime() !== startDate.getTime() &&
                        current.getTime() !== endDate.getTime()
                      ) {
                        ticks.push(new Date(current));
                      }
                      current.setDate(current.getDate() + 7);
                    }
                  } else {
                    // More than a month - show month boundaries
                    // Find the first day of the next month
                    const nextMonth = new Date(startDate);
                    nextMonth.setDate(1);
                    nextMonth.setMonth(nextMonth.getMonth() + 1);

                    current.setTime(nextMonth.getTime());
                    while (current <= end) {
                      if (
                        current.getTime() !== startDate.getTime() &&
                        current.getTime() !== endDate.getTime()
                      ) {
                        ticks.push(new Date(current));
                      }
                      current.setMonth(current.getMonth() + 1);
                    }
                  }

                  return ticks;
                })()}
                tickLabelProps={() => ({
                  fontSize: 11,
                  textAnchor: "middle",
                })}
                tickComponent={({ x, y, formattedValue }) => {
                  // Check if this is the last tick (end date) and adjust positioning
                  const isLastTick = x >= width - margin.right - 50; // 50px buffer from right edge
                  const textAnchor = isLastTick ? "end" : "middle";
                  const textX = isLastTick ? x - 5 : x; // Move text left for last tick

                  return (
                    <g>
                      <text
                        x={textX}
                        y={y - 4}
                        textAnchor={textAnchor}
                        fill="var(--gray-11)"
                        fontSize={11}
                      >
                        {formattedValue}
                      </text>
                      <line
                        x1={x}
                        y1={y}
                        x2={x}
                        y2={margin.top + filteredExperiments.length * rowHeight}
                        stroke="var(--gray-6)"
                        strokeWidth={1}
                      />
                    </g>
                  );
                }}
                hideTicks={true}
              />

              {/* Experiment Row Backgrounds */}
              {filteredExperiments.map((experiment, i) => (
                <rect
                  key={`bg-${experiment.id}`}
                  x={margin.left}
                  y={
                    (yScale(experiment.name || "") ?? 0) -
                    (yScale.paddingOuter() * yScale.bandwidth()) / 2
                  }
                  width={width - margin.left - margin.right}
                  height={
                    yScale.bandwidth() +
                    yScale.paddingOuter() * yScale.bandwidth()
                  }
                  fill={i % 2 === 0 ? "var(--gray-2)" : "transparent"}
                />
              ))}

              {/* Experiment Timelines - simplified bars */}
              {filteredExperiments.map((experiment) => {
                if (experiment.phases) {
                  return experiment.phases.map((phase, i) => {
                    const start = getValidDate(phase.dateStarted) ?? "";
                    const end =
                      experiment.status === "stopped"
                        ? getValidDate(phase.dateEnded) ?? ""
                        : new Date();
                    const colors = getPhaseColor(experiment, "running");
                    const winColors = getPhaseColor(experiment, "won");
                    const xStart = xScale(start);
                    const xEnd = xScale(end);
                    const rectWidth = Math.max(xEnd - xStart, 2); // Ensure minimal visibility
                    const winWidth = Math.max(xScale(new Date()) - xEnd, 2);
                    const rectHeight = yScale.bandwidth() * 0.5; // Thinner bars to match image
                    const yPosition = yScale(experiment.name);
                    if (yPosition === undefined) return null;

                    return (
                      <g key={`${experiment.id}-${phase.name}-${i}`}>
                        {experiment.status === "draft" ? null : (
                          <rect
                            x={xStart}
                            y={
                              yPosition + (yScale.bandwidth() - rectHeight) / 2
                            }
                            width={rectWidth}
                            height={rectHeight}
                            fill={colors.background}
                            stroke={colors.borderColor}
                            strokeWidth={1}
                            rx={4}
                            onMouseMove={(e) =>
                              handleBarMouseMove(
                                e,
                                experiment.name,
                                experiment.status,
                                experiment.results || "",
                                phase
                              )
                            }
                            onMouseLeave={handleBarMouseLeave}
                          />
                        )}
                        {experiment.status === "stopped" &&
                          experiment.results === "won" &&
                          experiment.phases.length - 1 === i && (
                            <rect
                              x={xEnd}
                              y={
                                yPosition +
                                (yScale.bandwidth() - rectHeight) / 2
                              }
                              width={winWidth}
                              height={rectHeight}
                              fill={winColors.background}
                              stroke={winColors.borderColor}
                              strokeWidth={1}
                              rx={4}
                              onMouseMove={(e) =>
                                handleBarMouseMove(
                                  e,
                                  experiment.name,
                                  experiment.status,
                                  experiment.results || "",
                                  phase
                                )
                              }
                              onMouseLeave={handleBarMouseLeave}
                            />
                          )}
                      </g>
                    );
                  });
                }
              })}
            </Group>
          </svg>
        </Box>
      )}
    </Box>
  );
};

export default HoldoutTimeline;
