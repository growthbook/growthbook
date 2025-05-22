import { scaleBand, scaleTime } from "@visx/scale";
import { Brush } from "@visx/brush";
import { Group } from "@visx/group";
import { AxisTop } from "@visx/axis";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { getValidDate } from "shared/dates";
import { useState } from "react";

const margin = { top: 50, right: 20, bottom: 50, left: 250 }; // Increased left margin for experiment names
const height = 400;
const width = 800;

const ExperimentTimeline: React.FC<{
  experiments: ExperimentInterfaceStringDates[];
}> = ({ experiments }) => {
  const today = new Date();
  const startDate = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000); // 90 days ago
  const endDate = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days in the future

  const [selectedDateRange, setSelectedDateRange] = useState<[Date, Date]>([
    startDate,
    endDate,
  ]);

  // Scales
  const xScale = scaleTime({
    domain: [startDate, endDate],
    range: [margin.left, width - margin.right],
  });

  const yScale = scaleBand({
    domain: experiments.map((e) => e.name),
    range: [margin.top, height - margin.bottom],
    padding: 0.2,
  });

  const handleBrushChange = (domain: { x0: number; x1: number }) => {
    if (!domain) return;
    setSelectedDateRange([new Date(domain.x0), new Date(domain.x1)]);
  };

  return (
    <div style={{ position: "relative" }}>
      {/* Fixed experiment names on the left */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: margin.top,
          width: margin.left - 10,
          height: height - margin.top - margin.bottom,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-around",
          backgroundColor: "var(--gray-1)",
        }}
      >
        {experiments.map((experiment) => (
          <div
            key={`name-${experiment.id}`}
            style={{
              padding: "4px 8px",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontWeight: 500,
              height: yScale.bandwidth(),
              display: "flex",
              alignItems: "center",
            }}
          >
            {experiment.name}
          </div>
        ))}
      </div>

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
          {experiments.map((experiment, i) => (
            <rect
              key={`bg-${experiment.id}`}
              x={margin.left}
              y={yScale(experiment.name)}
              width={width - margin.left - margin.right}
              height={yScale.bandwidth()}
              fill={i % 2 === 0 ? "var(--gray-3)" : "var(--gray-1)"}
              opacity={0.3}
            />
          ))}

          {/* Experiment Timelines */}
          {experiments.map((experiment) => {
            const start = getValidDate(
              experiment.phases?.[0]?.dateStarted ?? ""
            );
            const end = getValidDate(
              experiment.phases?.[experiment.phases.length - 1]?.dateEnded ?? ""
            );

            if (start > selectedDateRange[1] || end < selectedDateRange[0]) {
              return null; // Skip experiments outside the selected range
            }

            return (
              <rect
                key={experiment.id}
                x={xScale(start)}
                y={yScale(experiment.name)}
                width={Math.max(xScale(end) - xScale(start), 2)} // Ensure minimal visibility
                height={yScale.bandwidth()}
                fill="var(--jade-11)"
                rx={2}
              />
            );
          })}
        </Group>

        {/* Brush for date selection */}
        <Group top={height - margin.bottom + 10}>
          <Brush
            xScale={xScale}
            yScale={yScale}
            width={width - margin.left - margin.right}
            height={30}
            margin={{
              top: 0,
              bottom: 0,
              left: margin.left,
              right: margin.right,
            }}
            handleSize={8}
            onChange={handleBrushChange}
            resetOnEnd
          />
        </Group>
      </svg>
    </div>
  );
};

export default ExperimentTimeline;
