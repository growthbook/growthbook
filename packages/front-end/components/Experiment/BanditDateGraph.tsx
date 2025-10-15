/* eslint-disable @typescript-eslint/no-explicit-any */

import { FC, useEffect, useMemo, useState } from "react";
import { ParentSizeModern } from "@visx/responsive";
import { Group } from "@visx/group";
import { GridColumns, GridRows } from "@visx/grid";
import { scaleLinear, scaleTime } from "@visx/scale";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { AreaClosed, AreaStack, LinePath } from "@visx/shape";
import { curveLinear, curveMonotoneX, curveStepAfter } from "@visx/curve";
import {
  TooltipWithBounds,
  useTooltip,
  useTooltipInPortal,
} from "@visx/tooltip";
import { date, datetime } from "shared/dates";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { ScaleLinear, ScaleTime } from "d3-scale";
import { ExperimentMetricInterface } from "shared/experiments";
import { BanditEvent } from "back-end/src/validators/experiments";
import { BiCheckbox, BiCheckboxSquare } from "react-icons/bi";
import { useForm } from "react-hook-form";
import cloneDeep from "lodash/cloneDeep";
import { formatNumber, getExperimentMetricFormatter } from "@/services/metrics";
import { getVariationColor } from "@/services/features";
import { useCurrency } from "@/hooks/useCurrency";
import { useDefinitions } from "@/services/DefinitionsContext";
import SelectField from "@/components/Forms/SelectField";
import Callout from "@/ui/Callout";
import HelperText from "@/ui/HelperText";
import { SSRPolyfills } from "@/hooks/useSSRPolyfills";
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
  reweight?: boolean;
  weightsWereUpdated?: boolean;
  updateMessage?: string;
  initial?: boolean;
  error?: string;
  meta: DataPointVariation;
}
export interface BanditDateGraphProps {
  experiment: ExperimentInterfaceStringDates;
  metric: ExperimentMetricInterface | null;
  phase: number;
  label?: string;
  mode: "values" | "probabilities" | "weights";
  type: "line" | "area";
  ssrPolyfills?: SSRPolyfills;
  isPublic?: boolean;
}

const intPercentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 0,
});

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

type TooltipData = {
  x: number;
  y?: number[];
  d: BanditDateGraphDataPoint;
  reweight?: boolean;
  updateMessage?: string;
  error?: string;
  meta: any;
};

const height = 300;
const margin = [15, 30, 50, 80];

const getTooltipContents = (
  data: TooltipData,
  variationNames: string[],
  mode: "values" | "probabilities" | "weights",
  metric: ExperimentMetricInterface | null,
  getFactTableById: any,
  metricFormatterOptions: any,
  showVariations: boolean[],
  isPublic?: boolean,
) => {
  const { d } = data;
  return (
    <>
      {d.error !== "no rows" ? (
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
              <td>Users</td>
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
                    metricFormatterOptions,
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
                        ? getExperimentMetricFormatter(
                            metric,
                            getFactTableById,
                          )(meta?.[i].rawCi?.[0] ?? 0, metricFormatterOptions)
                        : (meta?.[i].rawCi?.[0] ?? 0)}
                      ,{" "}
                      {metric
                        ? getExperimentMetricFormatter(
                            metric,
                            getFactTableById,
                          )(meta?.[i].rawCi?.[1] ?? 0, metricFormatterOptions)
                        : (meta?.[i].rawCi?.[1] ?? 0)}
                      ]
                    </td>
                  )}
                  <td>{meta?.[i].users ?? 0}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : !isPublic ? (
        <div className="my-2" style={{ minWidth: 300 }}>
          <em>Bandit update failed</em>
        </div>
      ) : null}

      {!isPublic && (
        <div style={{ maxWidth: 330 }}>
          {!!d.reweight && !!d.weightsWereUpdated && (
            <HelperText status="info" my="2" size="md">
              Variation weights were recalculated
            </HelperText>
          )}
          {!!d.reweight && !d.weightsWereUpdated && (
            <HelperText status="warning" my="2" size="md">
              Variation weights were unable to update
            </HelperText>
          )}

          {d.updateMessage && !d.error ? (
            <Callout status="warning" my="2" size="sm">
              {d.updateMessage}
            </Callout>
          ) : null}

          {d.error ? (
            <Callout status="error" my="2" size="sm">
              {d.error}
            </Callout>
          ) : null}
        </div>
      )}

      <div className="text-sm-right mt-1 mr-1">
        {datetime(d.date as Date)}
        {d?.meta?.type === "today" ? (
          <small className="text-info ml-1">(today)</small>
        ) : null}
      </div>
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
  mode: "values" | "probabilities" | "weights",
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

  let d = stackedData[closestIndex];
  if (d?.meta?.type === "today" && mode !== "weights") {
    closestIndex = Math.max(0, closestIndex - 1);
    d = stackedData?.[closestIndex];
  }
  const x = xCoords[closestIndex];
  const y = d?.variations
    ? d.variations.map(
        (variation) => yScale(getYVal(variation, mode) ?? 0) ?? 0,
      )
    : undefined;
  const reweight = d?.reweight;
  const updateMessage = d?.updateMessage;
  const error = d?.error;
  const meta = d?.meta;
  return { x, y, d, reweight, updateMessage, error, meta };
};

const getYVal = (
  variation?: DataPointVariation,
  mode?: "values" | "probabilities" | "weights",
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
  phase,
  label,
  mode,
  type,
  ssrPolyfills,
  isPublic,
}) => {
  const formatter = formatNumber;

  const _displayCurrency = useCurrency();
  const { getFactTableById: _getFactTableById } = useDefinitions();

  const getFactTableById = ssrPolyfills?.getFactTableById || _getFactTableById;
  const displayCurrency = ssrPolyfills?.useCurrency() || _displayCurrency;
  const metricFormatterOptions = { currency: displayCurrency };

  const variationNames = experiment.variations.map((v) => v.name);
  const { containerRef, containerBounds } = useTooltipInPortal({
    scroll: true,
    detectBounds: true,
  });

  const form = useForm({
    defaultValues: {
      filterVariations: "all",
    },
  });
  const filterVariations = form.watch("filterVariations");
  const [showVariations, setShowVariations] = useState<boolean[]>(
    variationNames.map(() => true),
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
    const phaseObj = experiment.phases[phase];
    const events: BanditEvent[] = phaseObj?.banditEvents ?? [];

    const stackedData: any[] = [];

    let lastVal = variationNames.map(() => 1 / (variationNames.length || 2));
    events.forEach((event, eventNo) => {
      const bestArmProbabilities =
        event.banditResult?.bestArmProbabilities ?? [];

      const weights = event.banditResult.updatedWeights;

      const users = variationNames.map(
        (_, i) => event.banditResult?.singleVariationResults?.[i]?.users ?? 0,
      );

      const crs = variationNames.map(
        (_, i) => event.banditResult?.singleVariationResults?.[i]?.cr ?? 0,
      );

      const rawCis = event.banditResult?.singleVariationResults?.map(
        (svr) => svr?.ci,
      );
      const cis = event.banditResult?.singleVariationResults?.map((svr, i) =>
        svr?.ci?.map((cii) => ((users?.[i] ?? 0) > 0 ? cii : undefined)),
      );

      const dataPoint: any = {
        date: new Date(event.date),
        reweight: !!event.banditResult?.reweight,
        weightsWereUpdated: !!event.banditResult?.weightsWereUpdated,
        updateMessage:
          event.banditResult?.updateMessage &&
          event.banditResult?.updateMessage !== "successfully updated"
            ? event.banditResult?.updateMessage
            : undefined,
        initial: eventNo === 0,
        error: event.banditResult?.error,
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
          val = weights?.[i];
        }
        if (val !== undefined) {
          allEmpty = false;
        }
        dataPoint[i] = val ?? 0;
        dataPoint.meta[i] = {
          probability: bestArmProbabilities[i],
          weight: weights?.[i],
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
      now > stackedData[stackedData.length - 1].date
    ) {
      const dataPoint: BanditDateGraphDataPoint = { date: now, meta: {} };
      variationNames.forEach((_, i) => {
        dataPoint[i] = stackedData[stackedData.length - 1][i];
      });
      dataPoint.initial = stackedData[stackedData.length - 1].initial;
      dataPoint.error = stackedData[stackedData.length - 1].error;
      dataPoint.meta = { ...stackedData[stackedData.length - 1].meta };
      dataPoint.meta.type = "today";
      stackedData.push(dataPoint);
    }

    return stackedData;
  }, [experiment, phase, mode, variationNames]);

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
      const probabilities = (() => {
        let probs: number[] = [];
        let totalUsers = 0;
        for (let i = 0; i < variationNames.length; i++) {
          let prob =
            latestMeta?.[i]?.probability ?? 1 / (variationNames.length || 2);
          const users = latestMeta?.[i]?.users ?? 0;
          totalUsers += users;
          if (users < 100) {
            prob = NaN;
          }

          probs.push(prob);
        }
        if (totalUsers < 100 * variationNames.length) {
          probs = probs.map(() => 1 / (variationNames.length || 2));
        }
        return probs;
      })();

      function rankArray(values: (number | undefined)[]): number[] {
        const indices = values
          .map((value, index) => (value !== undefined ? index : -1))
          .filter((index) => index !== -1);
        indices.sort((a, b) => (values[b] as number) - (values[a] as number));
        const ranks = new Array(values.length).fill(0);
        indices.forEach((index, rank) => {
          ranks[index] = rank + 1;
        });
        return ranks;
      }

      const variationRanks = rankArray(probabilities);

      if (filterVariations === "5") {
        sv = variationNames.map((_, i) => variationRanks[i] <= 5);
      } else if (filterVariations === "3") {
        sv = variationNames.map((_, i) => variationRanks[i] <= 3);
      } else if (filterVariations === "1") {
        sv = variationNames.map((_, i) => variationRanks[i] <= 1);
      }
      setShowVariations(sv);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filterVariations],
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
                      .filter(
                        (_, i) =>
                          !(
                            d?.meta?.[i]?.cr === 0 &&
                            (d?.meta?.[i]?.ci?.[0] ?? 0) < -190
                          ),
                      )
                      .filter(() => !d?.error && !d.initial)
                      .filter((_, i) => showVariations[i]),
                  ),
                ),
              ) * 0.97,
              Math.max(
                ...stackedData.map((d) =>
                  Math.max(
                    ...variationNames
                      .map((_, i) => d?.meta?.[i]?.ci?.[1] ?? 0)
                      .filter(
                        (_, i) =>
                          !(
                            d?.meta?.[i]?.cr === 0 &&
                            (d?.meta?.[i]?.ci?.[1] ?? 0) > 190
                          ),
                      )
                      .filter(() => !d?.error && !d.initial)
                      .filter((_, i) => showVariations[i]),
                  ),
                ),
              ) * 1.03,
            ],
            range: [yMax, 0],
            round: true,
          })
        : scaleLinear<number>({
            domain: [0, 1],
            range: [yMax, 0],
          }),
    [variationNames, mode, stackedData, yMax, showVariations],
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
    <linearGradient
      key={`gradient-${i}`}
      id={`gradient-${i}`}
      x1="0%"
      y1="0%"
      x2="0%"
      y2="100%"
    >
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
  ));

  return (
    <ParentSizeModern>
      {({ width }) => {
        const xMax = width - margin[1] - margin[3];

        const allXTicks = stackedData.map((p) => p.date.getTime());
        const reweights = stackedData
          .filter((p) => p.meta?.type !== "today" && p?.reweight === true)
          .map((p) => p.date.getTime());
        const errorTicks = stackedData
          .filter((p) => p?.error && p.meta?.type !== "today")
          .map((p) => p.date.getTime());

        const xScale = scaleTime({
          domain: [min, max],
          range: [0, xMax],
          round: true,
        });

        const visibleTickIndexes = getVisibleTickIndexes(
          allXTicks,
          xScale,
          width * 0.11,
        );

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
            mode,
          );
          if (!data) {
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
        const exploitDate =
          stackedData.find(
            (p) => p.meta?.type !== "today" && p?.reweight === true,
          )?.date ?? undefined;
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
            <text
              x={xScale(exploitDate)}
              y={yMax + 38}
              fill="#66a"
              textAnchor="middle"
              fontSize={9}
              fontStyle={"italic"}
            >
              <tspan x={xScale(exploitDate)} dy="0">
                Exploratory
              </tspan>
              <tspan x={xScale(exploitDate)} dy="1em">
                stage end
              </tspan>
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
                  showVariations,
                  isPublic,
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
                width: width - margin[3],
                height: height - margin[0],
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
                      const users = tooltipData?.d?.meta?.[i]?.users ?? 0;
                      if (users === 0 && mode === "values") return;
                      return (
                        <div
                          key={i}
                          className={styles.positionIndicator}
                          style={{
                            transform: `translate(${tooltipLeft}px, ${yScale(
                              y,
                            )}px)`,
                            background: getVariationColor(i, true),
                          }}
                        />
                      );
                    })}
                  <div
                    className={styles.crosshair}
                    style={{
                      transform: `translateX(${tooltipLeft}px)`,
                      height: `calc(100% - ${margin[2]}px`,
                    }}
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
                  <rect fill="#b0b0b0" width="3.5" height="6" />
                  <rect fill="#a0a0a0" x="3.5" width="2.5" height="6" />
                </pattern>
                {exploreMask}
                <clipPath id="bandit-date-graph-clip">
                  <rect
                    x={0}
                    y={0}
                    width={Math.max(0, width - margin[1] - margin[3])}
                    height={Math.max(0, height - margin[0] - margin[2])}
                  />
                </clipPath>
                {gradients}
              </defs>
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
                  stroke="var(--border-color-300)"
                  height={yMax}
                  tickValues={reweights}
                />

                <Group clipPath="url(#bandit-date-graph-clip)">
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
                            ? curveLinear
                            : curveStepAfter
                      }
                      defined={(d) =>
                        d.data.meta.type === "today" ? mode === "weights" : true
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
                          defined={(d) =>
                            d?.meta?.[i]?.users !== 0 &&
                            d?.meta?.type !== "today"
                          }
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
                          defined={(d) =>
                            (mode !== "values" || d?.meta?.[i]?.users !== 0) &&
                            d?.meta?.type !== "today"
                          }
                        />
                      );
                    })}
                </Group>

                <AxisBottom
                  top={yMax}
                  scale={xScale}
                  stroke={"var(--text-color-table)"}
                  tickValues={allXTicks}
                  tickLabelProps={(value, i) => {
                    return visibleTickIndexes.includes(i)
                      ? {
                          fill: "var(--text-color-table)",
                          fontSize: 11,
                          textAnchor: "middle",
                          dy: 5,
                        }
                      : { display: "none" };
                  }}
                  tickFormat={(d) => {
                    return date(d as Date);
                  }}
                />

                <AxisBottom
                  top={yMax}
                  scale={xScale}
                  stroke={"transparent"}
                  tickLength={4}
                  tickValues={errorTicks}
                  tickFormat={() => "⚠️"}
                  tickLabelProps={() => ({
                    fontSize: 12,
                    textAnchor: "middle",
                    dy: 25,
                  })}
                  tickLineProps={{
                    stroke: "transparent",
                  }}
                />

                {exploreTick}
                <AxisLeft
                  scale={yScale}
                  stroke={"var(--text-color-table)"}
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
                            getFactTableById,
                          )(v as number, metricFormatterOptions)
                        : formatter(v as number)
                      : intPercentFormatter.format(v as number)
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

export function getVisibleTickIndexes(
  ticks: number[],
  xScale: ScaleTime<number, number>,
  minGap: number,
): number[] {
  const visibleIndexes: number[] = [];
  let lastXPosition = -Infinity;
  ticks.forEach((tick, index) => {
    const currentX = xScale(tick);
    if (currentX - lastXPosition >= minGap) {
      visibleIndexes.push(index);
      lastXPosition = currentX;
    }
  });
  return visibleIndexes;
}
