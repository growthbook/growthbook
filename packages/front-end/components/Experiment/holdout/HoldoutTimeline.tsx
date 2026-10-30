import { scaleBand, scaleTime } from "@visx/scale";
import { Group } from "@visx/group";
import { AxisTop } from "@visx/axis";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { StatusIndicatorData } from "shared/enterprise";
import { getAllVariations } from "shared/experiments";
import { getValidDate } from "shared/dates";
import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Box, Flex, Heading, Text } from "@radix-ui/themes";
import { format } from "date-fns";
import { GridColumns } from "@visx/grid";
import EmptyState from "@/components/EmptyState";
import { useExperimentStatusIndicator } from "@/hooks/useExperimentStatusIndicator";
import { useHoverTooltip } from "@/hooks/useHoverTooltip";
import ExperimentStatusIndicator, {
  getFormattedLabel,
} from "@/components/Experiment/TabbedPage/ExperimentStatusIndicator";
import { PopoverContent } from "@/ui/Popover";
import VariationLabel from "@/ui/VariationLabel";
import { allDates } from "@/components/Experiment/TabbedPage/statusSchedule";

const margin = { top: 30, right: 60, bottom: 30, left: 200 }; // Increased right margin to prevent end tick cutoff
// Ticks per label as the axis narrows; months stay on calendar boundaries.
const LABEL_STEPS = [1, 2, 3, 6, 12, 24, 60];
// How far a bar still going runs past "now", fading out.
const PAST_NOW_PX = 10;

// Hovers like a result in the results table: a strip in the status badge's
// color, then the run's dates.
function TimelineBar({
  experiment,
  statusIndicator,
  shippedVariation,
  shipped = false,
  open = false,
  ...rect
}: {
  experiment: ExperimentInterfaceStringDates;
  statusIndicator: StatusIndicatorData;
  shippedVariation: { name: string; index: number } | null;
  // The stretch since a winner shipped, after the run itself.
  shipped?: boolean;
  // Still going: runs on past "now", fading out, instead of ending.
  open?: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
}) {
  const { triggerProps, renderTooltip } = useHoverTooltip();
  const fadeId = `fade${useId().replace(/:/g, "")}`;
  const { color, status, detailedStatus } = statusIndicator;
  const { x, y, width, height } = rect;
  const end = x + width + (open ? PAST_NOW_PX : 0);
  const row = (label: string, value: React.ReactNode) => (
    <Flex key={label} align="center" justify="between" gap="3">
      <Text
        size="1"
        weight="medium"
        style={{ color: "var(--color-text-high)" }}
      >
        {label}
      </Text>
      <Text size="1" style={{ color: "var(--color-text-high)" }}>
        {value}
      </Text>
    </Flex>
  );
  return (
    <>
      {open ? (
        <defs>
          <linearGradient
            id={`${fadeId}_grad`}
            gradientUnits="userSpaceOnUse"
            x1={x + width}
            x2={end}
            y1={0}
            y2={0}
          >
            <stop offset="0" stopColor="white" />
            <stop offset="1" stopColor="white" stopOpacity="0" />
          </linearGradient>
          <mask id={fadeId} maskUnits="userSpaceOnUse">
            <rect
              x={x - 1}
              y={y - 1}
              width={end - x + 1}
              height={height + 2}
              fill={`url(#${fadeId}_grad)`}
            />
          </mask>
        </defs>
      ) : null}
      <rect
        {...rect}
        {...triggerProps}
        // Open, its rounded end and border sit past the mask.
        width={open ? end - x + 8 : width}
        mask={open ? `url(#${fadeId})` : undefined}
        fill={shipped ? `var(--${color}-a3)` : `var(--${color}-a5)`}
        stroke={shipped ? `var(--${color}-a7)` : `var(--${color}-9)`}
        strokeWidth={1}
        rx={4}
      />
      {renderTooltip(
        <PopoverContent>
          <Flex direction="column" minWidth="240px" maxWidth="360px">
            <Flex
              px="4"
              py="2px"
              style={{
                backgroundColor: `var(--${color}-9)`,
                color: `var(--${color}-contrast)`,
                borderRadius: "var(--radius-3) var(--radius-3) 0 0",
              }}
            >
              <Text size="1" weight="bold">
                {getFormattedLabel("full", status, detailedStatus)}
              </Text>
            </Flex>
            <Flex direction="column" gap="1" px="4" py="2">
              <Text
                size="2"
                weight="medium"
                mb="1"
                style={{ color: "var(--color-text-high)" }}
              >
                {experiment.name}
              </Text>
              {/* As the header lists them, past its creation. */}
              {allDates(experiment, new Date())
                .slice(1)
                .map(({ label, value }) => row(label, value))}
              {experiment.releasedVariationId
                ? row(
                    "Shipped",
                    shippedVariation ? (
                      <VariationLabel
                        number={shippedVariation.index}
                        name={shippedVariation.name}
                        size="sm"
                        maxWidth="140px"
                        disableTooltip
                      />
                    ) : (
                      "--"
                    ),
                  )
                : null}
            </Flex>
          </Flex>
        </PopoverContent>,
      )}
    </>
  );
}

const HoldoutTimeline: React.FC<{
  experiments: ExperimentInterfaceStringDates[];
  startDate: Date;
  holdoutEndDate?: Date;
}> = ({ experiments, startDate, holdoutEndDate }) => {
  // Drafts, then newest start first: down the rows goes back in time.
  const rows = useMemo(() => {
    const started = (e: ExperimentInterfaceStringDates) =>
      getValidDate(e.phases[0]?.dateStarted).getTime();
    const draft = (e: ExperimentInterfaceStringDates) =>
      e.status === "draft" ? 1 : 0;
    return [...experiments].sort(
      (a, b) => draft(b) - draft(a) || started(b) - started(a),
    );
  }, [experiments]);
  const containerRef = useRef<HTMLDivElement>(null);
  // Find the earliest start date from all experiment phases
  const [endDateIsNow, setEndDateIsNow] = useState(false);
  // this is to prevent the now line moving when it renders
  const endDate = useMemo(() => {
    if (!holdoutEndDate) {
      setEndDateIsNow(true);
      return new Date();
    }
    return holdoutEndDate;
  }, [setEndDateIsNow, holdoutEndDate]);
  const [width, setWidth] = useState(800); // Default width
  const rowHeight = 36;
  const height = margin.top + margin.bottom + experiments.length * rowHeight;

  const getStatusIndicator = useExperimentStatusIndicator();

  const hasExperiments = experiments.length > 0;
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    // Follows the container, which the details rail resizes too.
    const observer = new ResizeObserver(() => setWidth(container.offsetWidth));
    observer.observe(container);
    return () => observer.disconnect();
  }, [hasExperiments]);

  // Calculate scale domain to align with ticks
  const getScaleDomain = useMemo(() => {
    const rangeInDays =
      (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);

    // Create a copy of startDate to avoid mutating the original
    const adjustedStartDate = new Date(startDate);
    if (rangeInDays > 1) {
      adjustedStartDate.setHours(0, 0, 0, 0);
    }

    if (rangeInDays < 7) {
      // Less than a week - use start and end dates as is
      return [adjustedStartDate, endDate];
    } else if (rangeInDays < 30) {
      // Less than a month - use start and end dates as is
      const previousMonday = new Date(adjustedStartDate);
      previousMonday.setDate(previousMonday.getDate() - 1);
      previousMonday.setDate(
        previousMonday.getDate() - (previousMonday.getDay() - 1),
      );
      return [previousMonday, endDate];
    } else {
      // More than a month - align with month boundaries
      const scaleStart = new Date(adjustedStartDate);
      scaleStart.setDate(1); // Start at first day of the month
      return [scaleStart, endDate];
    }
  }, [startDate, endDate]);

  // Scales
  const xScale = scaleTime({
    domain: getScaleDomain,
    range: [margin.left, width - margin.right],
  });
  const yScale = scaleBand({
    domain: rows.map((e) => e.id),
    range: [margin.top, height - margin.bottom],
    padding: 0.05, // Minimal padding for tighter spacing
  });
  const tickValues = useMemo(() => {
    const [scaleStart, scaleEnd] = getScaleDomain;
    const ticks: Date[] = [];
    const current = new Date(scaleStart);
    const end = new Date(scaleEnd);
    const rangeInDays =
      (end.getTime() - scaleStart.getTime()) / (1000 * 60 * 60 * 24);

    if (rangeInDays < 7) {
      // Less than a week - show days
      ticks.push(new Date(scaleStart));
      while (current.getTime() <= endDate.getTime()) {
        if (
          current.getTime() !== scaleStart.getTime() &&
          current.getTime() < scaleEnd.getTime()
        ) {
          ticks.push(new Date(current));
        }
        current.setDate(current.getDate() + 1);
      }
    } else if (rangeInDays < 30) {
      // Less than a month - show week boundaries (Mondays)
      const previousMonday = new Date(scaleStart);
      previousMonday.setDate(previousMonday.getDate() - 1);
      previousMonday.setDate(
        previousMonday.getDate() - (previousMonday.getDay() - 1),
      );
      ticks.push(new Date(previousMonday));

      const nextMonday = new Date(scaleStart);
      const daysUntilMonday = (8 - nextMonday.getDay()) % 7;
      if (daysUntilMonday > 0) {
        nextMonday.setDate(nextMonday.getDate() + daysUntilMonday);
      }

      current.setTime(nextMonday.getTime());
      while (current.getTime() <= endDate.getTime()) {
        if (
          current.getTime() !== scaleStart.getTime() &&
          current.getTime() < scaleEnd.getTime()
        ) {
          ticks.push(new Date(current));
        }
        current.setDate(current.getDate() + 7);
      }
    } else {
      // More than a month - show month boundaries
      const nextMonth = new Date(scaleStart);
      nextMonth.setDate(1);
      ticks.push(new Date(nextMonth)); // Add the first month
      nextMonth.setMonth(nextMonth.getMonth() + 1);

      current.setTime(nextMonth.getTime());
      while (current.getTime() <= endDate.getTime()) {
        if (
          current.getTime() !== scaleStart.getTime() &&
          current.getTime() < scaleEnd.getTime()
        ) {
          ticks.push(new Date(current));
        }
        current.setMonth(current.getMonth() + 1);
      }
    }
    if (!endDateIsNow) {
      ticks.push(new Date(endDate));
    }
    return ticks;
  }, [getScaleDomain, endDate, endDateIsNow]);

  const rangeInDays =
    (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
  const monthly = rangeInDays >= 30;
  // Labels thin to what fits; every tick keeps its line.
  const labelStep = useMemo(() => {
    if (tickValues.length < 2) return 1;
    const spacing =
      (width - margin.left - margin.right) / (tickValues.length - 1);
    const labelWidth = monthly ? 80 : 56;
    return (
      LABEL_STEPS.find((step) => step * spacing >= labelWidth) ??
      LABEL_STEPS[LABEL_STEPS.length - 1]
    );
  }, [tickValues.length, width, monthly]);
  const tickLabel = (d: Date, index: number): string => {
    const isEnd = !endDateIsNow && index === tickValues.length - 1;
    if (!monthly) {
      return isEnd || index % labelStep === 0 ? format(d, "MMM d") : "";
    }
    const labeled =
      isEnd ||
      (labelStep <= 12
        ? d.getMonth() % labelStep === 0
        : d.getMonth() === 0 && d.getFullYear() % (labelStep / 12) === 0);
    if (!labeled) return "";
    return labelStep >= 12 && !isEnd
      ? format(d, "yyyy")
      : format(d, "MMM yyyy");
  };

  const tickComponent = ({ x, y, formattedValue }) => {
    // Check if this is the last tick (end date) and adjust positioning
    const isLastTick = x >= width - margin.right - 50; // 50px buffer from right edge
    const textAnchor = isLastTick ? "end" : "middle";
    const textX = isLastTick ? x - 5 : x; // Move text left for last tick

    return (
      <g>
        {formattedValue ? (
          <text
            x={textX}
            y={y - 6}
            textAnchor={textAnchor}
            fontSize={14}
            fontWeight="medium"
            fill="var(--slate-11)"
          >
            {formattedValue}
          </text>
        ) : null}
        {/* A labelled tick is a major line, so its date reads against it. */}
        <line
          x1={x}
          y1={formattedValue ? y - 2 : y}
          x2={x}
          y2={experiments.length * rowHeight}
          stroke={formattedValue ? "var(--gray-8)" : "var(--gray-a2)"}
          strokeWidth={isLastTick ? 2 : 1}
        />
      </g>
    );
  };
  return (
    <Box>
      {experiments.length === 0 ? (
        <EmptyState
          title="No experiments found"
          description="No Experiments in the holdout"
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
            {/* Experiment label header */}
            <Box
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: -33,
                height: 33.5,
                display: "flex",
                alignItems: "center",
                padding: "0 12px",
              }}
            >
              <Heading as="h2" size="3">
                Experiments
              </Heading>
            </Box>
            {rows.map((experiment, i) => (
              <Box
                key={`name-${experiment.id}`}
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  top:
                    (yScale(experiment.id) ?? 0) -
                    margin.top -
                    (yScale.paddingOuter() * yScale.bandwidth()) / 2,
                  height:
                    yScale.bandwidth() +
                    yScale.paddingOuter() * yScale.bandwidth(),
                  display: "flex",
                  alignItems: "center",
                  padding: "0 12px",
                  borderTop: i > 0 ? "1px solid var(--gray-a4)" : undefined,
                }}
              >
                <Flex align="center" gap="2" minWidth="0" width="100%">
                  <Text
                    size="2"
                    weight="medium"
                    style={{
                      color: "var(--gray-12)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      minWidth: 0,
                    }}
                  >
                    <Link
                      href={`/experiment/${experiment.id}`}
                      style={{
                        textDecoration: "none",
                      }}
                    >
                      {experiment.name}
                    </Link>
                  </Text>
                  {/* Drafts have no bar to show it. */}
                  {experiment.status === "draft" ? (
                    <Box flexShrink="0">
                      <ExperimentStatusIndicator
                        experimentData={experiment}
                        size="xs"
                      />
                    </Box>
                  ) : null}
                </Flex>
              </Box>
            ))}
          </Box>
          <svg key={width} width={width} height={height}>
            <Group>
              {/* Row dividers, as a table has, continuing the label column's. */}
              {rows.slice(1).map((experiment) => {
                const y =
                  (yScale(experiment.id) ?? 0) -
                  (yScale.paddingOuter() * yScale.bandwidth()) / 2;
                return (
                  <line
                    key={`divider-${experiment.id}`}
                    x1={margin.left}
                    x2={width - margin.right}
                    y1={y}
                    y2={y}
                    stroke="var(--gray-a4)"
                  />
                );
              })}

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
                tickFormat={(d, index) =>
                  d instanceof Date ? tickLabel(d, index) : "-"
                }
                tickValues={tickValues}
                tickLabelProps={() => ({
                  fontSize: 11,
                  textAnchor: "middle",
                })}
                tickComponent={tickComponent}
                hideTicks={true}
                hideAxisLine={true}
              />

              {endDateIsNow && (
                <g>
                  <line
                    x1={xScale(endDate)}
                    y1={margin.top}
                    x2={xScale(endDate)}
                    y2={height - margin.bottom}
                    stroke="var(--red-9)"
                    strokeWidth={2}
                    strokeDasharray="5,5"
                  />
                  <text
                    x={xScale(endDate) + 8}
                    y={margin.top - 8}
                    fontSize={11}
                    fill="var(--red-9)"
                    fontWeight="bold"
                  >
                    Now
                  </text>
                </g>
              )}

              {rows.map((experiment) => {
                const yPosition = yScale(experiment.id);
                if (yPosition === undefined || experiment.status === "draft") {
                  return null;
                }
                const variations = getAllVariations(experiment);
                const variationIndex = variations.findIndex(
                  (v) => v.id === experiment.releasedVariationId,
                );
                const shippedVariation = variations[variationIndex]
                  ? {
                      name: variations[variationIndex].name,
                      index: variationIndex,
                    }
                  : null;
                const statusIndicator = getStatusIndicator(experiment);
                const rectHeight = yScale.bandwidth() * 0.5;
                const y = yPosition + (yScale.bandwidth() - rectHeight) / 2;
                return experiment.phases.map((phase, i) => {
                  const xStart = xScale(getValidDate(phase.dateStarted));
                  // Only a running experiment's current phase is still going.
                  const ongoing =
                    experiment.status !== "stopped" &&
                    i === experiment.phases.length - 1;
                  const xEnd = xScale(
                    ongoing ? endDate : getValidDate(phase.dateEnded),
                  );
                  const bar = {
                    experiment,
                    statusIndicator,
                    shippedVariation,
                    y,
                    height: rectHeight,
                  };
                  return (
                    <g key={`${experiment.id}-${phase.name}-${i}`}>
                      <TimelineBar
                        {...bar}
                        open={ongoing && endDateIsNow}
                        x={xStart}
                        width={Math.max(xEnd - xStart, 2)}
                      />
                      {experiment.status === "stopped" &&
                      experiment.results === "won" &&
                      experiment.phases.length - 1 === i ? (
                        <TimelineBar
                          {...bar}
                          shipped
                          open={endDateIsNow}
                          x={xEnd}
                          width={Math.max(xScale(endDate) - xEnd, 2)}
                        />
                      ) : null}
                    </g>
                  );
                });
              })}
            </Group>
          </svg>
        </Box>
      )}
    </Box>
  );
};

export default HoldoutTimeline;
