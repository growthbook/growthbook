import { scaleBand, scaleTime } from "@visx/scale";
import { Group } from "@visx/group";
import { AxisTop } from "@visx/axis";
import {
  ExperimentInterfaceStringDates,
  ExperimentPhaseStringDates,
  ExperimentStatus,
} from "shared/types/experiment";
import { getValidDate, date } from "shared/dates";
import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Box, Flex } from "@radix-ui/themes";
import {
  TooltipWithBounds,
  useTooltip,
  defaultStyles as tooltipDefaultStyles,
} from "@visx/tooltip";
import { format } from "date-fns";
import { GridColumns } from "@visx/grid";
import Text from "@/ui/Text";
import styles from "@/components/Metrics/DateGraph.module.scss";
import { formatPercent } from "@/services/metrics";
import EmptyState from "@/components/EmptyState";

const margin = { top: 20, right: 20, bottom: 50, left: 250 }; // Increased left margin for experiment names

const getPhaseColor = (
  experiment: ExperimentInterfaceStringDates,
  phase: ExperimentPhaseStringDates,
) => {
  const densityNumber = 7; //Math.round(bgMinColor + phase.coverage * (bgMaxColor - bgMinColor));
  const borderDensityNumber = 11; //Math.round(minBorderColor + phase.coverage * (maxBorderColor - minBorderColor));
  const mainColor =
    experiment.status === "running"
      ? "cyan"
      : experiment.results === "dnf"
        ? "bronze"
        : experiment.results === "inconclusive"
          ? "gold"
          : experiment.results === "lost"
            ? "red"
            : experiment.results === "won"
              ? "jade"
              : phase.name === "Main"
                ? "cyan"
                : "plum";

  return {
    background: `var(--${mainColor}-${densityNumber})`,
    borderColor: `var(--${mainColor}-${borderDensityNumber})`,
    text: densityNumber > 8 ? `var(--slate-1)` : `var(--slate-11)`,
  };
};

const ExperimentTimeline: React.FC<{
  experiments: ExperimentInterfaceStringDates[];
  startDate: Date;
  endDate: Date;
}> = ({ experiments, startDate, endDate }) => {
  const showPhase = false;
  const today = new Date();
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipTimeout = useRef<NodeJS.Timeout | null>(null);

  // we need to filter the experiments to only those that have phases within the selected date range:
  const filteredExperiments = useMemo(() => {
    return experiments.filter((experiment) => {
      if (experiment.status === "draft") return false; // drafts don't have dates/phases (or shouldn't)
      if (!experiment.phases || experiment.phases.length === 0) return false;
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
  const rowHeight = 30;
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
    estimate?: boolean;
  }>();

  const handleBarMouseMove = (
    event: React.MouseEvent<SVGRectElement>,
    experimentName: string,
    status: ExperimentStatus,
    result: string,
    phase: ExperimentPhaseStringDates,
    estimate: boolean = false,
  ) => {
    if (!containerRef.current) return;

    const containerRect = containerRef.current.getBoundingClientRect();
    const rect = event.currentTarget.getBoundingClientRect();

    const tooltipLeft = event.clientX - containerRect.left; //- rect.left + containerRect.left; // + rect.width / 2; // Center of the rectangle
    const tooltipTop = rect.top - containerRect.top - 10; // Just below the rectangle

    // Clear any existing timeout
    if (tooltipTimeout.current) {
      clearTimeout(tooltipTimeout.current);
    }
    // Set a timeout to show the tooltip
    tooltipTimeout.current = setTimeout(() => {
      showTooltip({
        tooltipLeft,
        tooltipTop,
        tooltipData: { experimentName, status, result, phase, estimate },
      });
    }, 150); // 150ms delay
  };

  const handleBarMouseLeave = () => {
    // Clear the timeout and hide the tooltip
    if (tooltipTimeout.current) {
      clearTimeout(tooltipTimeout.current);
    }
    hideTooltip();
  };

  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current) {
        setWidth(containerRef.current.offsetWidth);
      }
    };

    handleResize(); // Set initial width
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Scales
  const xScale = scaleTime({
    domain: [startDate, endDate],
    range: [margin.left, width - margin.right],
  });
  const yScale = scaleBand({
    domain: filteredExperiments.map((e) => e.name),
    range: [margin.top, height - margin.bottom],
    padding: 0.2,
  });

  // Todo: pagination?

  const currentDateX = xScale(today);
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
              overflow: "hidden",
              width: margin.left - 10,
              height: height - margin.top - margin.bottom,
              display: "flex",
              gap: yScale.paddingOuter() * yScale.bandwidth() + "px",
              flexDirection: "column",
              justifyContent: "space-around",
              backgroundColor: "var(--indigo-2)",
              boxShadow: "10px 0 10px -5px rgba(0, 0, 0, 0.05)",
            }}
          >
            {filteredExperiments.map((experiment) => (
              <Box
                key={`name-${experiment.id}`}
                style={{
                  padding: "0 4px",
                  position: "absolute",
                  left: 0,
                  right: 0,
                  top: (yScale(experiment.name) ?? 0) - margin.top,
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  fontWeight: 500,
                  marginBottom: 0,
                  height: yScale.bandwidth(),
                  lineHeight: yScale.bandwidth() + "px",
                  alignItems: "center",
                  fontSize: "0.8rem",
                  borderBottom: "1px solid var(--slate-a3)",
                }}
              >
                <Link
                  href={`/experiment/${experiment.id}`}
                  title={experiment.name}
                >
                  {experiment.name}
                </Link>
              </Box>
            ))}
          </Box>
          {tooltipOpen && tooltipData && (
            <TooltipWithBounds
              left={tooltipLeft}
              top={tooltipTop}
              className={styles.tooltip}
              style={tooltipDefaultStyles}
            >
              <Box mb="2">
                <strong>Experiment:</strong> {tooltipData.experimentName}
              </Box>
              <Flex direction="column" gap="1" style={{ fontSize: "0.8rem" }}>
                <Box>
                  <strong>Status:</strong> {tooltipData.status}
                </Box>
                {tooltipData.result && (
                  <Box>
                    <strong>Result:</strong> {tooltipData.result}
                  </Box>
                )}
                <Box>
                  <strong>Phase:</strong> {tooltipData.phase.name}
                </Box>
                <Box>
                  <strong>Coverage:</strong>{" "}
                  {formatPercent(tooltipData.phase.coverage)}
                </Box>
                <Box>
                  <strong>Started:</strong>{" "}
                  {tooltipData.phase.dateStarted
                    ? date(tooltipData.phase.dateStarted, "UTC")
                    : "-"}
                </Box>
                {tooltipData.status === "stopped" && (
                  <Box>
                    <strong>Ended:</strong>{" "}
                    {tooltipData.phase.dateEnded
                      ? date(tooltipData.phase.dateEnded, "UTC")
                      : "-"}
                  </Box>
                )}
                {tooltipData.estimate && (
                  <Box>
                    <Text size="small">
                      This experiment is running and the end date is unknown.
                    </Text>
                  </Box>
                )}
              </Flex>
            </TooltipWithBounds>
          )}
          <svg width={width} height={height}>
            <rect width={width} height={height} fill="none" />
            <Group>
              <GridColumns
                top={margin.top}
                scale={xScale}
                width={width}
                height={height - margin.top - margin.bottom}
                stroke="var(--slate-a5)"
                strokeDasharray="2,2"
                strokeWidth={1}
              />
              {/* X-Axis at the top */}
              <AxisTop
                top={margin.top}
                scale={xScale}
                tickFormat={(d) => {
                  if (d instanceof Date) {
                    const day = d.getDate();
                    return day === 1
                      ? format(d, "yyyy MMM") // Show "YYYY MMM" for the first day of the month
                      : format(d, "yyyy MMM dd"); // Show "YYYY MMM DD" otherwise
                  }
                  return "-";
                }}
                numTicks={Math.floor(width / 160)} // Adjust number of ticks based on width
                tickLabelProps={() => ({
                  fill: "var(--text-color-table)",
                  fontSize: 11,
                  textAnchor: "middle",
                  dy: -4, // Adjust vertical alignment
                })}
                stroke="var(--slate-8)"
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
                  fill={i % 2 === 0 ? "var(--gray-4)" : "var(--gray-1)"}
                  opacity={0.3}
                />
              ))}

              {/* Experiment Timelines - show a rectangle per phase */}
              {filteredExperiments.map((experiment) => {
                if (experiment.phases) {
                  return experiment.phases.map((phase, i) => {
                    const start = getValidDate(phase.dateStarted) ?? "";
                    const end =
                      experiment.status === "stopped"
                        ? (getValidDate(phase.dateEnded) ?? "")
                        : new Date();
                    const colors = getPhaseColor(experiment, phase);
                    const xStart = xScale(start);
                    const xEnd = xScale(end);
                    const runningEnd =
                      typeof endDate === "number" &&
                      typeof today.getTime() === "number" &&
                      endDate - today.getTime() > 14 * 24 * 60 * 60 * 1000
                        ? today.getTime() + 14 * 24 * 60 * 60 * 1000
                        : endDate;
                    const rectWidth = Math.max(xEnd - xStart, 2); // Ensure minimal visibility
                    const rectHeight = yScale.bandwidth();
                    const yPosition = yScale(experiment.name);
                    if (yPosition === undefined) return null;

                    return (
                      <g key={`${experiment.id}-${phase.name}-${i}`}>
                        <rect
                          x={xStart}
                          y={yPosition}
                          width={rectWidth}
                          height={rectHeight}
                          fill={colors.background}
                          stroke={colors.borderColor}
                          strokeWidth={1}
                          rx={2}
                          onMouseMove={(e) =>
                            handleBarMouseMove(
                              e,
                              experiment.name,
                              experiment.status,
                              experiment.results || "",
                              phase,
                            )
                          }
                          onMouseLeave={handleBarMouseLeave}
                        />
                        {showPhase && (
                          <>
                            <text
                              x={xStart + 4} // Add padding inside the rectangle
                              y={yPosition + rectHeight / 2 + 4} // Center the text vertically
                              fill={colors.text}
                              fontSize="11"
                              fontWeight="bold"
                              style={{ pointerEvents: "none" }} // Prevent text from interfering with interactions
                              //dominantBaseline="middle" // Vertically center the text
                              //clipPath={`inset(0 ${Math.max(0, rectWidth - 4)}px 0 0)`} // Ensure text doesn't overflow
                            >
                              {phase.name}
                              {experiment.status === "stopped"
                                ? ` (${experiment.results})`
                                : ` (${experiment.status})`}
                            </text>
                          </>
                        )}
                        {experiment.status === "running" && (
                          <>
                            <defs>
                              <linearGradient
                                id={"fadeGradient" + experiment.id}
                                x1="0%"
                                y1="0%"
                                x2="100%"
                                y2="0%"
                              >
                                <stop
                                  offset="0%"
                                  stopColor={colors.background}
                                  stopOpacity={1}
                                />
                                <stop
                                  offset="100%"
                                  stopColor={colors.background}
                                  stopOpacity={0}
                                />
                              </linearGradient>
                            </defs>

                            <rect
                              x={xEnd}
                              y={yPosition}
                              // estimate how long it will take to finish?
                              width={Math.max(xScale(runningEnd) - xEnd, 2)}
                              height={rectHeight}
                              fill={"url(#fadeGradient" + experiment.id + ")"}
                              stroke={colors.borderColor}
                              strokeWidth={1}
                              strokeDasharray={4}
                              rx={2}
                              onMouseMove={(e) =>
                                handleBarMouseMove(
                                  e,
                                  experiment.name,
                                  experiment.status,
                                  experiment.results || "",
                                  phase,
                                  true,
                                )
                              }
                              onMouseLeave={handleBarMouseLeave}
                            />
                          </>
                        )}
                      </g>
                    );
                  });
                }
              })}
            </Group>
            {/* Red vertical line for the current date */}
            <line
              x1={currentDateX}
              y1={margin.top}
              x2={currentDateX}
              y2={height - margin.bottom}
              stroke="red"
              strokeWidth={2}
              strokeDasharray="4 2" // Optional: dashed line
            />
          </svg>
        </Box>
      )}
    </Box>
  );
};

export default ExperimentTimeline;
