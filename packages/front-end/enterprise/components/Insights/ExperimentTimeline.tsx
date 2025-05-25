import { scaleBand, scaleTime } from "@visx/scale";
import { Group } from "@visx/group";
import { AxisTop } from "@visx/axis";
import {
  ExperimentInterfaceStringDates,
  ExperimentPhaseStringDates,
} from "back-end/types/experiment";
import { getValidDate } from "shared/dates";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Box } from "@radix-ui/themes";

const margin = { top: 50, right: 20, bottom: 50, left: 250 }; // Increased left margin for experiment names

const getPhaseColor = (
  experiment: ExperimentInterfaceStringDates,
  phase: ExperimentPhaseStringDates
) => {
  const bgMinColor = 3;
  const bgMaxColor = 7;
  const densityNumber = Math.round(
    bgMinColor + phase.coverage * (bgMaxColor - bgMinColor)
  );
  const minBorderColor = 9;
  const maxBorderColor = 11;
  const borderDensityNumber = Math.round(
    minBorderColor + phase.coverage * (maxBorderColor - minBorderColor)
  );
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
  const today = new Date();
  const containerRef = useRef<HTMLDivElement>(null);

  // we need to filter the experiments to only those that have phases within the selected date range:
  const filteredExperiments = useMemo(() => {
    return experiments.filter((experiment) => {
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

  const currentDateX = xScale(today);
  return (
    <Box>
      <Box ref={containerRef} style={{ position: "relative", width: "100%" }}>
        {/* Fixed experiment names on the left */}
        <Box
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            overflow: "hidden",
            width: margin.left - 10,
            height: height,
            display: "flex",
            gap: yScale.paddingOuter() * yScale.bandwidth() + "px",
            flexDirection: "column",
            justifyContent: "space-around",
            backgroundColor: "var(--indigo-2)",
          }}
        >
          {filteredExperiments.map((experiment) => (
            <Box
              key={`name-${experiment.id}`}
              style={{
                padding: "0",
                overflow: "hidden",
                position: "absolute",
                left: 4,
                top: yScale(experiment.name),
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontWeight: 500,
                marginBottom: 0,
                height: yScale.bandwidth(),
                lineHeight: yScale.bandwidth() + "px",
                alignItems: "center",
                fontSize: "0.8rem",
              }}
            >
              <Link href={`/experiment/${experiment.id}`}>
                {experiment.name}
              </Link>
            </Box>
          ))}
        </Box>

        <svg width={width} height={height}>
          <rect width={width} height={height} fill="none" />
          <Group>
            {/* X-Axis at the top */}
            <AxisTop
              top={margin.top}
              scale={xScale}
              tickFormat={(d) =>
                d instanceof Date ? getValidDate(d).toLocaleDateString() : "-"
              }
            />

            {/* Experiment Row Backgrounds */}
            {filteredExperiments.map((experiment, i) => (
              <rect
                key={`bg-${experiment.id}`}
                x={margin.left}
                y={yScale(experiment.name)}
                width={width - margin.left - margin.right}
                height={yScale.bandwidth()}
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
                      ? getValidDate(phase.dateEnded) ?? ""
                      : new Date();
                  const colors = getPhaseColor(experiment, phase);
                  const xStart = xScale(start);
                  const xEnd = xScale(end);
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
                      />
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
                      {experiment.status === "running" && (
                        <rect
                          x={xEnd}
                          y={yPosition}
                          width={Math.max(xScale(endDate) - xEnd, 2)}
                          height={rectHeight}
                          fill={colors.background}
                          stroke={colors.borderColor}
                          strokeWidth={1}
                          strokeDasharray={4}
                          rx={2}
                        />
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
    </Box>
  );
};

export default ExperimentTimeline;
