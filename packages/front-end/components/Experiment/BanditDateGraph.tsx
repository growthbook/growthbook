/* eslint-disable @typescript-eslint/no-explicit-any */

import { FC, useMemo } from "react";
import { ParentSizeModern } from "@visx/responsive";
import { Group } from "@visx/group";
import { GridColumns, GridRows } from "@visx/grid";
import { scaleLinear, scaleTime } from "@visx/scale";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { AreaStack, LinePath } from "@visx/shape";
import { curveMonotoneX, curveStepAfter } from "@visx/curve";
import {
  TooltipWithBounds,
  useTooltip,
  useTooltipInPortal,
} from "@visx/tooltip";
import { date, datetime } from "shared/dates";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { ScaleLinear } from "d3-scale";
import { formatNumber } from "@/services/metrics";
import { getVariationColor } from "@/services/features";
import styles from "./ExperimentDateGraph.module.scss";

export interface DataPointVariation {
  probability?: number;
  weight?: number;
  snapshotId?: string;
}
export interface BanditDateGraphDataPoint {
  date: Date;
  variations?: DataPointVariation[]; // undefined === missing date
}
export interface BanditDateGraphProps {
  experiment: ExperimentInterfaceStringDates;
  label: string;
  mode: "probabilities" | "weights";
  type: "line" | "area";
}

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 1,
});

type TooltipData = {
  x: number;
  y?: number[];
  d: BanditDateGraphDataPoint;
  meta: any;
};

const height = 300;
const margin = [15, 25, 50, 65];

const getTooltipContents = (
  data: TooltipData,
  variationNames: string[],
  mode: "probabilities" | "weights"
) => {
  const { d } = data;
  return (
    <>
      <table className={`table-condensed ${styles.table}`}>
        <thead>
          <tr>
            <td></td>
            <td>
              {mode === "probabilities"
                ? "Chance to be Best"
                : "Variation Weight"}
            </td>
          </tr>
        </thead>
        <tbody>
          {variationNames.map((v, i) => {
            const val = d[i];
            return (
              <tr key={i}>
                <td
                  className="text-ellipsis"
                  style={{ color: getVariationColor(i, true) }}
                >
                  {v}
                </td>
                <td>{val !== undefined ? percentFormatter.format(val) : ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="text-sm-right mt-1 mr-1">{datetime(d.date as Date)}</div>
    </>
  );
};

// Finds the closest date to the cursor and figures out x/y coordinates
const getTooltipData = (
  mx: number,
  width: number,
  stackedData: any[],
  yScale: ScaleLinear<number, number, never>,
  xScale,
  mode: "probabilities" | "weights"
): TooltipData => {
  const xCoords = stackedData.map((d) => xScale(d.date));

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

  const d = stackedData[closestIndex];
  const x = xCoords[closestIndex];
  const y = d?.variations
    ? d.variations.map(
        (variation) => yScale(getYVal(variation, mode) ?? 0) ?? 0
      )
    : undefined;
  const meta = d?.meta;
  return { x, y, d, meta };
};

const getYVal = (
  variation?: DataPointVariation,
  mode?: "probabilities" | "weights"
) => {
  if (!variation) return undefined;
  switch (mode) {
    case "probabilities":
      return variation.probability ?? 0;
    case "weights":
      return variation.weight ?? 0;
    default:
      return undefined;
  }
};

const BanditDateGraph: FC<BanditDateGraphProps> = ({
  experiment,
  label,
  mode,
  type,
}) => {
  const formatter = formatNumber;
  const variationNames = experiment.variations.map((v) => v.name);
  const { containerRef, containerBounds } = useTooltipInPortal({
    scroll: true,
    detectBounds: true,
  });

  const {
    showTooltip,
    hideTooltip,
    tooltipOpen,
    tooltipData,
    tooltipLeft = 0,
    tooltipTop = 0,
  } = useTooltip<TooltipData>();

  const stackedData = useMemo(() => {
    const phase = experiment.phases[experiment.phases.length - 1];
    const events = phase?.banditEvents ?? [];

    const stackedData: any[] = [];

    let lastVal = variationNames.map(() => 1 / (variationNames.length || 2));
    events.forEach((event) => {
      const bestArmProbabilities =
        event.banditResult?.bestArmProbabilities ?? [];
      const weights = event.banditResult?.weights ?? [];

      const dataPoint: any = {
        date: new Date(event.date),
        meta: {},
      };

      let allEmpty = true;
      variationNames.forEach((_, i) => {
        let val = 0;
        if (mode === "probabilities") {
          val = bestArmProbabilities[i];
        } else if (mode === "weights") {
          val = weights[i];
        }
        if (val !== undefined) {
          allEmpty = false;
        }
        dataPoint[i] = val ?? 0;
        dataPoint.meta[i] = {
          probabilities: bestArmProbabilities[i],
          weights: weights[i],
        };
      });
      if (allEmpty) {
        variationNames.forEach((_, i) => {
          dataPoint[i] = lastVal[i];
        });
        dataPoint.empty = true;
      } else {
        lastVal = variationNames.map((_, i) => dataPoint[i]);
      }

      stackedData.push(dataPoint);
    });

    // Insert today if it exceeds the last datapoint and the experiment is live
    const now = new Date();
    if (
      experiment.status === "running" &&
      // todo: analyzing current phase?
      now > stackedData[stackedData.length - 1].date
    ) {
      const dataPoint = {
        date: now,
        meta: {
          type: "today",
        },
      };
      variationNames.forEach((_, i) => {
        dataPoint[i] = stackedData[stackedData.length - 1][i];
      });
      stackedData.push(dataPoint);
    }

    return stackedData;
  }, [experiment, mode, variationNames]);

  // Get y-axis domain
  const yDomain = [0, 1];

  // Get x-axis domain
  const min =
    stackedData.length > 0
      ? Math.min(...stackedData.map((d) => d.date.getTime()))
      : 0;
  const max =
    stackedData.length > 0
      ? Math.max(...stackedData.map((d) => d.date.getTime()))
      : 0;

  const gradients = variationNames.map((_, i) => (
    <defs key={`gradient-${i}`}>
      <linearGradient id={`gradient-${i}`} x1="0%" y1="0%" x2="0%" y2="100%">
        <stop
          offset="0%"
          stopColor={getVariationColor(i, true)}
          stopOpacity={0.75}
        />
        <stop
          offset="100%"
          stopColor={getVariationColor(i, true)}
          stopOpacity={0.65}
        />
      </linearGradient>
    </defs>
  ));

  return (
    <ParentSizeModern>
      {({ width }) => {
        const yMax = height - margin[0] - margin[2];
        const xMax = width - margin[1] - margin[3];

        const allXTicks = stackedData
          .filter((p) => p.meta?.type !== "today")
          .map((p) => p.date.getTime());

        const xScale = scaleTime({
          domain: [min, max],
          range: [0, xMax],
          round: true,
        });
        const yScale = scaleLinear<number>({
          domain: yDomain,
          range: [yMax, 0],
        });

        const handlePointer = (event: React.PointerEvent<HTMLDivElement>) => {
          // coordinates should be relative to the container in which Tooltip is rendered
          const containerX =
            ("clientX" in event ? event.clientX : 0) - containerBounds.left;
          const data = getTooltipData(
            containerX,
            width,
            stackedData,
            yScale,
            xScale,
            mode
          );
          if (!data || data.meta?.type === "today") {
            hideTooltip();
            return;
          }
          showTooltip({
            tooltipLeft: data.x,
            tooltipTop: 0,
            tooltipData: data,
          });
        };

        const startDate = stackedData[0].date;
        // todo: handle no exploitDate (still exploring)
        const exploitDate = experiment.banditPhaseDateStarted
          ? new Date(experiment.banditPhaseDateStarted)
          : undefined;
        const lastDate = stackedData[stackedData.length - 1].date;
        const exploreMask = (
          <mask id="stripe-mask">
            <rect
              x={xScale(startDate)}
              y={0}
              width={xScale(exploitDate ?? lastDate) - xScale(startDate)}
              height={yMax}
              fill="url(#stripe-pattern)"
            />
            <rect
              x={xScale(exploitDate ?? lastDate)}
              y="0"
              width={width - xScale(exploitDate ?? lastDate)}
              height={yMax}
              fill="white"
            />
          </mask>
        );
        const exploreTick = exploitDate ? (
          <g>
            <line
              x1={xScale(exploitDate)}
              y1={0}
              x2={xScale(exploitDate)}
              y2={yMax + 20} // Adjust length of tick mark
              stroke="green"
            />
            <text
              x={xScale(exploitDate) - 10}
              y={yMax + 34}
              fill="green"
              textAnchor="middle"
              fontSize={12}
              fontStyle={"italic"}
            >
              Burn-in end
            </text>
          </g>
        ) : null;

        return (
          <div className="position-relative">
            {tooltipData && (
              <TooltipWithBounds
                left={tooltipLeft + margin[3]}
                top={tooltipTop + margin[0]}
                className={`tooltip-banditDateGraph ${styles.tooltip}`}
                unstyled={true}
              >
                {getTooltipContents(tooltipData, variationNames, mode)}
              </TooltipWithBounds>
            )}
            <div className="d-flex flex-wrap" style={{ gap: "0.25rem 1rem" }}>
              {variationNames.map((v, i) => {
                return (
                  <div
                    key={i}
                    className="nowrap text-ellipsis"
                    style={{ maxWidth: 200, color: getVariationColor(i, true) }}
                  >
                    <strong>&mdash;</strong> {v}
                  </div>
                );
              })}
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
                  {type === "line" &&
                    variationNames.map((v, i) => {
                      // Render a dot at the current x location for each variation
                      const y = tooltipData?.d?.[i];
                      if (y === undefined) return;
                      return (
                        <div
                          key={i}
                          className={styles.positionIndicator}
                          style={{
                            transform: `translate(${tooltipLeft}px, ${yScale(
                              tooltipData.d[i]
                            )}px)`,
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
                <pattern
                  id="stripe-pattern"
                  patternUnits="userSpaceOnUse"
                  width="6"
                  height="6"
                  patternTransform="rotate(45)"
                >
                  <rect fill="#cccccc" width="3.5" height="6" />
                  <rect fill="#aaaaaa" x="3.5" width="2.5" height="6" />
                </pattern>
                {exploreMask}
              </defs>
              {gradients}
              <Group left={margin[3]} top={margin[0]}>
                <GridRows
                  scale={yScale}
                  width={xMax}
                  tickValues={[0.25, 0.5, 0.75]}
                  stroke="var(--border-color-200)"
                />
                <GridColumns
                  scale={xScale}
                  stroke="var(--border-color-200)"
                  height={yMax}
                  tickValues={allXTicks}
                />

                {type === "area" && (
                  <AreaStack
                    keys={variationNames.map((_, i) => i)}
                    data={stackedData}
                    x={(d) => xScale(d.data.date)}
                    y0={(d) => yScale(d[0])}
                    y1={(d) => yScale(d[1])}
                    order="reverse"
                    curve={
                      mode === "probabilities" ? curveMonotoneX : curveStepAfter
                    }
                  >
                    {({ stacks, path }) =>
                      stacks.map((stack, i) => (
                        <path
                          key={`stack-${stack.key}`}
                          d={path(stack) || ""}
                          stroke={getVariationColor(i, true)}
                          fill={`url(#gradient-${i})`}
                          mask="url(#stripe-mask)"
                        />
                      ))
                    }
                  </AreaStack>
                )}

                {type === "line" &&
                  variationNames.map((_, i) => (
                    <LinePath
                      key={`linepath-${i}`}
                      data={stackedData}
                      x={(d) => xScale(d.date)}
                      y={(d) => yScale(d[i])}
                      stroke={getVariationColor(i, true)}
                      strokeWidth={2}
                      curve={
                        mode === "probabilities"
                          ? curveMonotoneX
                          : curveStepAfter
                      }
                    />
                  ))}

                <AxisBottom
                  top={yMax}
                  scale={xScale}
                  tickValues={allXTicks}
                  tickLabelProps={(value, i) => {
                    const currentX = xScale(value);
                    let hide = false;

                    // Loop through previous ticks to see if any are too close
                    for (let j = 0; j < i; j++) {
                      const prevX = xScale(allXTicks[j]);
                      if (Math.abs(currentX - prevX) < width * 0.05) {
                        hide = true;
                        break; // Stop checking if a close tick is found
                      }
                    }
                    if (hide)
                      return {
                        display: "none",
                      };

                    return {
                      fill: "var(--text-color-table)",
                      fontSize: 11,
                      textAnchor: "middle",
                      dx: i < allXTicks.length - 1 ? 0 : -20,
                      dy: 5,
                    };
                  }}
                  tickFormat={(d) => {
                    return date(d as Date);
                  }}
                />
                {exploreTick}
                <AxisLeft
                  scale={yScale}
                  tickValues={[0, 0.25, 0.5, 0.75, 1]}
                  labelOffset={40}
                  tickFormat={(v) => formatter(v as number)}
                  tickLabelProps={() => ({
                    fill: "var(--text-color-table)",
                    fontSize: 11,
                    textAnchor: "end",
                    dx: -5,
                    dy: 3,
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
export default BanditDateGraph;
