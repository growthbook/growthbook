/* eslint-disable @typescript-eslint/no-explicit-any */

import { FC, useEffect, useMemo, useState } from "react";
import { ParentSizeModern } from "@visx/responsive";
import { Group } from "@visx/group";
import { GridColumns, GridRows } from "@visx/grid";
import { scaleLinear, scaleTime } from "@visx/scale";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { AreaClosed, AreaStack, LinePath } from "@visx/shape";
import { curveMonotoneX, curveStepAfter } from "@visx/curve";
import {
  TooltipWithBounds,
  useTooltip,
  useTooltipInPortal,
} from "@visx/tooltip";
import { date, datetime } from "shared/dates";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { ScaleLinear } from "d3-scale";
import { MetricInterface } from "@back-end/types/metric";
import { BiCheckbox, BiCheckboxSquare } from "react-icons/bi";
import { useForm } from "react-hook-form";
import cloneDeep from "lodash/cloneDeep";
import { formatNumber, getExperimentMetricFormatter } from "@/services/metrics";
import { getVariationColor } from "@/services/features";
import { useCurrency } from "@/hooks/useCurrency";
import { useDefinitions } from "@/services/DefinitionsContext";
import SelectField from "@/components/Forms/SelectField";
import styles from "./ExperimentDateGraph.module.scss";

export interface DataPointVariation {
  probability?: number;
  weight?: number;
  users?: number;
  cr?: number;
  ci?: number;
  rawCi?: number;
  type?: string;
  snapshotId?: string;
}
export interface BanditDateGraphDataPoint {
  [key: `${number}`]: number;
  date: Date;
  meta: DataPointVariation;
}
export interface BanditDateGraphProps {
  experiment: ExperimentInterfaceStringDates;
  metric: MetricInterface | null;
  label?: string;
  mode: "values" | "probabilities" | "weights";
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
const margin = [15, 25, 50, 70];

const getTooltipContents = (
  data: TooltipData,
  variationNames: string[],
  mode: "values" | "probabilities" | "weights",
  metric: MetricInterface | null,
  getFactTableById: any,
  metricFormatterOptions: any,
  showVariations: boolean[]
) => {
  const { d } = data;
  return (
    <>
      <table className={`table-condensed ${styles.table}`}>
        <thead>
          <tr>
            <td></td>
            <td>
              {mode === "values"
                ? "Variation Mean"
                : mode === "probabilities"
                ? "Probability of Winning"
                : "Variation Weight"}
            </td>
            {mode === "values" && <td>CI</td>}
          </tr>
        </thead>
        <tbody>
          {variationNames.map((v, i) => {
            if (!showVariations[i]) return null;
            const val = d[i];
            const meta = d.meta;
            const crFormatted = metric
              ? getExperimentMetricFormatter(metric, getFactTableById)(
                  val,
                  metricFormatterOptions
                )
              : val;
            return (
              <tr key={i}>
                <td
                  className="text-ellipsis"
                  style={{ color: getVariationColor(i, true) }}
                >
                  {v}
                </td>
                <td>
                  {mode === "values" && crFormatted !== undefined
                    ? crFormatted
                    : null}
                  {mode !== "values" && val !== undefined
                    ? percentFormatter.format(val)
                    : null}
                </td>
                {mode === "values" && (
                  <td className="small">
                    [
                    {metric
                      ? getExperimentMetricFormatter(metric, getFactTableById)(
                          meta?.[i].rawCi?.[0] ?? 0,
                          metricFormatterOptions
                        )
                      : meta?.[i].rawCi?.[0] ?? 0}
                    ,{" "}
                    {metric
                      ? getExperimentMetricFormatter(metric, getFactTableById)(
                          meta?.[i].rawCi?.[1] ?? 0,
                          metricFormatterOptions
                        )
                      : meta?.[i].rawCi?.[1] ?? 0}
                    ]
                  </td>
                )}
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
  mode: "values" | "probabilities" | "weights"
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
  mode?: "values" | "probabilities" | "weights"
) => {
  if (!variation) return undefined;
  switch (mode) {
    case "values":
      return variation.cr ?? 0;
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
  metric,
  label,
  mode,
  type,
}) => {
  const formatter = formatNumber;

  const metricDisplayCurrency = useCurrency();
  const metricFormatterOptions = { currency: metricDisplayCurrency };
  const { getFactTableById } = useDefinitions();

  const variationNames = experiment.variations.map((v) => v.name);
  const { containerRef, containerBounds } = useTooltipInPortal({
    scroll: true,
    detectBounds: true,
  });

  const form = useForm({
    defaultValues: {
      filterVariations: "",
    },
  });
  const filterVariations = form.watch("filterVariations");
  const [showVariations, setShowVariations] = useState<boolean[]>(
    variationNames.map(() => true)
  );

  const {
    showTooltip,
    hideTooltip,
    tooltipOpen,
    tooltipData,
    tooltipLeft = 0,
    tooltipTop = 0,
  } = useTooltip<TooltipData>();

  const stackedData: BanditDateGraphDataPoint[] = useMemo(() => {
    const phase = experiment.phases[experiment.phases.length - 1];
    const events = phase?.banditEvents ?? [];

    const stackedData: any[] = [];

    let lastVal = variationNames.map(() => 1 / (variationNames.length || 2));
    let lastUsers = variationNames.map(() => 0);
    let lastCrs = variationNames.map(() => 0);
    events.forEach((event) => {
      const bestArmProbabilities =
        event.banditResult?.bestArmProbabilities ?? [];

      const weights = event.banditResult?.weights ?? [];

      const users = variationNames.map(
        (_, i) =>
          (event.banditResult?.singleVariationResults?.[i]?.users ?? 0) +
          lastUsers[i]
      );
      lastUsers = users;

      const crs = variationNames.map(
        (_, i) =>
          (event.banditResult?.singleVariationResults?.[i]?.cr ?? 0) +
          lastCrs[i]
      );
      lastCrs = crs;

      const rawCis = event.banditResult?.singleVariationResults?.map((svr, i) =>
        svr?.ci ? svr.ci.map((cii) => cii + (lastVal?.[i] ?? 0)) : undefined
      );
      const cis = event.banditResult?.singleVariationResults?.map((svr, i) =>
        svr?.ci
          ? svr.ci.map((cii) =>
              (users?.[i] ?? 0) > 0 ? cii + (lastVal?.[i] ?? 0) : undefined
            )
          : undefined
      );

      const dataPoint: any = {
        date: new Date(event.date),
        meta: {},
      };

      let allEmpty = true;
      variationNames.forEach((_, i) => {
        let val = 0;
        if (mode === "values") {
          val = crs[i];
        } else if (mode === "probabilities") {
          val = bestArmProbabilities[i];
        } else if (mode === "weights") {
          val = weights[i];
        }
        if (val !== undefined) {
          allEmpty = false;
        }
        dataPoint[i] = val ?? 0;
        dataPoint.meta[i] = {
          probability: bestArmProbabilities[i],
          weight: weights[i],
          users: users?.[i],
          cr: crs[i],
          ci: cis?.[i],
          rawCi: rawCis?.[i],
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
      const dataPoint: BanditDateGraphDataPoint = {
        date: now,
        meta: {
          type: "today",
        },
      };
      variationNames.forEach((_, i) => {
        dataPoint[i] = stackedData[stackedData.length - 1][i];
      });
      dataPoint.meta = stackedData[stackedData.length - 1].meta;
      stackedData.push(dataPoint);
    }

    return stackedData;
  }, [experiment, mode, variationNames]);

  const filteredStackedData: BanditDateGraphDataPoint[] = useMemo(() => {
    const filtered = cloneDeep(stackedData);
    for (let i = 0; i < filtered.length; i++) {
      showVariations.forEach((sv, j) => {
        if (!sv) delete filtered[i][j];
      });
    }
    return filtered;
  }, [stackedData, showVariations]);

  // handle variation filter selector
  useEffect(
    () => {
      let sv = [...showVariations];
      if (filterVariations === "all") {
        sv = variationNames.map(() => true);
        setShowVariations(sv);
        return;
      }
      const latestMeta = stackedData[stackedData.length - 1].meta;
      const sorted = Object.entries(latestMeta)
        .sort(([, a], [, b]) => b.probability - a.probability)
        .map(([key]) => key);
      if (filterVariations === "5") {
        sv = variationNames.map((_, i) => sorted.indexOf(i + "") < 5);
      } else if (filterVariations === "3") {
        sv = variationNames.map((_, i) => sorted.indexOf(i + "") < 3);
      } else if (filterVariations === "1") {
        sv = variationNames.map((_, i) => sorted.indexOf(i + "") < 1);
      }
      setShowVariations(sv);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filterVariations]
  );

  const yMax = height - margin[0] - margin[2];

  const yScale = useMemo(
    () =>
      mode === "values"
        ? scaleLinear<number>({
            domain: [
              Math.min(
                ...stackedData.map((d) =>
                  Math.min(
                    ...variationNames
                      .map((_, i) => d?.meta?.[i]?.ci?.[0] ?? 0)
                      .filter((_, i) => showVariations[i])
                  )
                )
              ) * 1.03,
              Math.max(
                ...stackedData.map((d) =>
                  Math.max(
                    ...variationNames
                      .map((_, i) => d?.meta?.[i]?.ci?.[1] ?? 0)
                      .filter((_, i) => showVariations[i])
                  )
                )
              ) * 1.03,
            ],
            range: [yMax, 0],
            round: true,
          })
        : scaleLinear<number>({
            domain: [0, 1],
            range: [yMax, 0],
          }),
    [variationNames, mode, stackedData, yMax, showVariations]
  );

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
        const xMax = width - margin[1] - margin[3];

        const allXTicks = stackedData
          .filter((p) => p.meta?.type !== "today")
          .map((p) => p.date.getTime());

        const xScale = scaleTime({
          domain: [min, max],
          range: [0, xMax],
          round: true,
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
        const exploitDate = experiment.banditPhaseDateStarted
          ? new Date(experiment.banditPhaseDateStarted)
          : undefined;
        const lastDate = stackedData[stackedData.length - 1].date;
        const exploreMask =
          xScale(exploitDate ?? lastDate) - xScale(startDate) > 0 ? (
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
          ) : null;
        const exploreTick = exploitDate ? (
          <g>
            <line
              x1={xScale(exploitDate)}
              y1={0}
              x2={xScale(exploitDate)}
              y2={yMax}
              stroke="#66a9"
            />
            <text
              x={xScale(exploitDate) - 5}
              y={yMax + 36}
              fill="#66a"
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
                {getTooltipContents(
                  tooltipData,
                  variationNames,
                  mode,
                  metric,
                  getFactTableById,
                  metricFormatterOptions,
                  showVariations
                )}
              </TooltipWithBounds>
            )}
            <div className="d-flex align-items-start">
              <div className="position-relative" style={{ top: -17 }}>
                <label className="uppercase-title text-muted mb-0">
                  Filter variations
                </label>
                <SelectField
                  style={{ width: 135 }}
                  containerClassName="select-dropdown-underline"
                  isSearchable={false}
                  sort={false}
                  options={[
                    {
                      label: "All variations",
                      value: "all",
                    },
                    ...(variationNames.length > 5
                      ? [
                          {
                            label: "Top 5",
                            value: "5",
                          },
                        ]
                      : []),
                    ...(variationNames.length > 3
                      ? [
                          {
                            label: "Top 3",
                            value: "3",
                          },
                        ]
                      : []),
                    {
                      label: "Winning variation",
                      value: "1",
                    },
                    ...(form.watch("filterVariations") === ""
                      ? [
                          {
                            label: `selected (${
                              showVariations.filter((sv) => sv).length
                            })`,
                            value: "",
                          },
                        ]
                      : []),
                  ]}
                  value={form.watch("filterVariations")}
                  onChange={(v) => {
                    form.setValue("filterVariations", v);
                  }}
                />
              </div>
              <div
                className="d-flex flex-wrap px-3 mb-2"
                style={{ gap: "0.25rem 1rem" }}
              >
                {variationNames.map((v, i) => {
                  return (
                    <div
                      key={i}
                      className="nowrap text-ellipsis cursor-pointer hover-highlight py-1 pr-1 rounded user-select-none"
                      style={{
                        maxWidth: 200,
                        color: getVariationColor(i, true),
                      }}
                      onClick={() => {
                        let sv = [...showVariations];
                        sv[i] = !sv[i];
                        if (sv.every((v) => !v)) {
                          sv = variationNames.map((_, j) => i !== j);
                        }
                        setShowVariations(sv);
                        if (sv.every((v) => v)) {
                          form.setValue("filterVariations", "all");
                        } else {
                          form.setValue("filterVariations", "");
                        }
                      }}
                    >
                      {showVariations[i] ? (
                        <BiCheckboxSquare size={24} />
                      ) : (
                        <BiCheckbox size={24} />
                      )}
                      {v}
                    </div>
                  );
                })}
              </div>
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
                    variationNames.map((_, i) => {
                      // Render a dot at the current x location for each variation
                      if (!showVariations[i]) return null;
                      const y = tooltipData?.d?.[i];
                      if (y === undefined) return;
                      return (
                        <div
                          key={i}
                          className={styles.positionIndicator}
                          style={{
                            transform: `translate(${tooltipLeft}px, ${yScale(
                              y
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
                  tickValues={mode !== "values" ? [0.25, 0.5, 0.75] : undefined}
                  numTicks={5}
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
                    data={filteredStackedData}
                    x={(d) => xScale(d.data.date)}
                    y0={(d) => yScale(d[0])}
                    y1={(d) => yScale(d[1])}
                    order="reverse"
                    curve={
                      mode === "values"
                        ? curveMonotoneX
                        : mode === "probabilities"
                        ? curveMonotoneX
                        : curveStepAfter
                    }
                  >
                    {({ stacks, path }) =>
                      stacks.map((stack, i) => {
                        if (!showVariations[i]) return null;
                        return (
                          <path
                            key={`stack-${stack.key}`}
                            d={path(stack) || ""}
                            stroke={getVariationColor(i, true)}
                            fill={`url(#gradient-${i})`}
                            mask="url(#stripe-mask)"
                          />
                        );
                      })
                    }
                  </AreaStack>
                )}

                {mode === "values" &&
                  variationNames.map((_, i) => {
                    if (!showVariations[i]) return null;
                    return (
                      <AreaClosed
                        key={`ci_${i}`}
                        yScale={yScale}
                        data={stackedData}
                        x={(d) => xScale(d.date)}
                        y0={(d) => yScale(d?.meta?.[i]?.ci?.[0] ?? 0) ?? 0}
                        y1={(d) => yScale(d?.meta?.[i]?.ci?.[1] ?? 0) ?? 0}
                        fill={getVariationColor(i, true)}
                        opacity={0.12}
                        curve={curveMonotoneX}
                      />
                    );
                  })}

                {type === "line" &&
                  variationNames.map((_, i) => {
                    if (!showVariations[i]) return null;
                    return (
                      <LinePath
                        key={`linepath-${i}`}
                        data={stackedData}
                        x={(d) => xScale(d.date)}
                        y={(d) => yScale(d[i])}
                        stroke={getVariationColor(i, true)}
                        strokeWidth={2}
                        curve={
                          mode === "values"
                            ? curveMonotoneX
                            : mode === "probabilities"
                            ? curveMonotoneX
                            : curveStepAfter
                        }
                      />
                    );
                  })}

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
                      if (Math.abs(currentX - prevX) < width * 0.06) {
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
                  tickValues={
                    mode !== "values" ? [0, 0.25, 0.5, 0.75, 1] : undefined
                  }
                  numTicks={5}
                  labelOffset={40}
                  tickFormat={(v) =>
                    mode === "values"
                      ? metric
                        ? getExperimentMetricFormatter(
                            metric,
                            getFactTableById
                          )(v as number, metricFormatterOptions)
                        : formatter(v as number)
                      : formatter(v as number)
                  }
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
