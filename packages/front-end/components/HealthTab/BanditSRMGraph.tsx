/* eslint-disable @typescript-eslint/no-explicit-any */

import { FC, Fragment, useMemo, useState } from "react";
import { ParentSizeModern } from "@visx/responsive";
import { Group } from "@visx/group";
import { GridColumns, GridRows } from "@visx/grid";
import { scaleLinear, scaleTime } from "@visx/scale";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { AreaClosed, LinePath } from "@visx/shape";
import { curveMonotoneX, curveStepAfter } from "@visx/curve";
import {
  TooltipWithBounds,
  useTooltip,
  useTooltipInPortal,
} from "@visx/tooltip";
import { date, datetime } from "shared/dates";
import {
  ExperimentInterfaceStringDates,
  ExperimentPhaseStringDates,
} from "back-end/types/experiment";
import { BiRadioCircle, BiRadioCircleMarked } from "react-icons/bi";
import { formatNumber } from "@/services/metrics";
import { getVariationColor } from "@/services/features";
import styles from "@/components/Experiment/ExperimentDateGraph.module.scss";
import { getVisibleTickIndexes } from "@/components/Experiment/BanditDateGraph";

export interface BanditSRMGraphDataPoint {
  date: Date;
  users: number[];
  expectedUsers: number[];
  userRatios: (number | undefined)[];
  weights: number[];
  srm?: number;
}
export interface BanditSRMGraphProps {
  experiment: ExperimentInterfaceStringDates;
  phase: ExperimentPhaseStringDates;
  mode: "users" | "weights";
}

const intPercentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 0,
});
const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 1,
});

const formatter = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 0,
  minimumFractionDigits: 0,
});

type TooltipData = {
  x: number;
  d: BanditSRMGraphDataPoint;
};

const height = 300;
const margin = [15, 25, 50, 70];

const getTooltipContents = (
  data: TooltipData,
  variationNames: string[],
  mode: "users" | "weights",
  showVariations: boolean[],
) => {
  const { d } = data;
  return (
    <>
      <table className={`table-condensed ${styles.table}`}>
        <thead>
          <tr>
            <td className="border-bottom-0" />
            <td className="border-bottom-0" colSpan={3}>
              {mode === "users" ? "Users" : "Traffic Split"}
            </td>
          </tr>
          <tr>
            <td />
            <td>Expected</td>
            <td>Actual</td>
            <td>Δ</td>
          </tr>
        </thead>
        <tbody>
          {variationNames.map((v, i) => {
            if (!showVariations[i]) return null;
            const expectedUsers = data?.d?.expectedUsers?.[i] ?? 0;
            const users = data?.d?.users?.[i] ?? 0;
            const weight = data?.d?.weights?.[i] ?? 0;
            const userRatio = data?.d?.userRatios?.[i];
            return (
              <tr key={i}>
                <td
                  className="text-ellipsis"
                  style={{ color: getVariationColor(i, true) }}
                >
                  {v}
                </td>
                <td>
                  {mode === "users"
                    ? formatter.format(expectedUsers)
                    : percentFormatter.format(weight)}
                </td>
                <td>
                  {mode === "users" ? (
                    formatter.format(users)
                  ) : userRatio ? (
                    percentFormatter.format(userRatio)
                  ) : (
                    <em>n/a</em>
                  )}
                </td>
                <td>
                  {mode === "users" ? (
                    formatter.format(users - expectedUsers)
                  ) : userRatio ? (
                    percentFormatter.format(userRatio - weight)
                  ) : (
                    <em>n/a</em>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {/*<div className="mt-1 mb-2 text-right">*/}
      {/*  p-value:{" "}*/}
      {/*  {d.srm !== undefined ? pValueFormatter(d.srm, 4) : <em>n/a</em>}*/}
      {/*</div>*/}
      <div className="text-sm-right mt-1 mr-1">{datetime(d.date as Date)}</div>
    </>
  );
};

// Finds the closest date to the cursor and figures out x/y coordinates
const getTooltipData = (
  mx: number,
  width: number,
  stackedData: any[],
  xScale,
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
  return { x, d };
};

const BanditSRMGraph: FC<BanditSRMGraphProps> = ({
  experiment,
  phase,
  mode,
}) => {
  const formatter = formatNumber;

  const variationNames = experiment.variations.map((v) => v.name);
  const { containerRef, containerBounds } = useTooltipInPortal({
    scroll: true,
    detectBounds: true,
  });

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

  const data: BanditSRMGraphDataPoint[] = useMemo(() => {
    const events = phase?.banditEvents ?? [];

    const data: any[] = [];

    let previousUsers = variationNames.map(() => 0);

    events.forEach((event, i) => {
      // only use reweighted events + the latest event
      if (!event.banditResult.reweight && i !== events.length - 1) {
        return;
      }
      const weights = event.banditResult.currentWeights;

      const users = variationNames.map(
        (_, i) =>
          (event.banditResult?.singleVariationResults?.[i]?.users ?? 0) -
          (previousUsers?.[i] ?? 0),
      );
      previousUsers = variationNames.map(
        (_, i) => event.banditResult?.singleVariationResults?.[i]?.users ?? 0,
      );
      const totalUsers = users.reduce((sum, val) => sum + val, 0);
      const expectedUsers = variationNames.map(
        (_, i) => (weights[i] ?? 0) * totalUsers,
      );

      const userRatios = variationNames.map((_, i) =>
        totalUsers ? (users[i] ?? 0) / totalUsers : undefined,
      );

      const srm = event?.health?.srm;

      const dataPoint: BanditSRMGraphDataPoint = {
        date: new Date(event.date),
        users,
        expectedUsers,
        userRatios,
        weights,
        srm,
      };

      data.push(dataPoint);
    });

    return data;
  }, [phase, variationNames]);

  const yMax = height - margin[0] - margin[2];

  const yScale = useMemo(
    () =>
      mode === "users"
        ? scaleLinear<number>({
            domain: [
              Math.min(
                ...data.map((d) =>
                  Math.min(
                    ...variationNames
                      .map((_, i) => d?.users?.[i] ?? 0)
                      .filter((_, i) => showVariations[i]),
                    ...variationNames
                      .map((_, i) => d?.expectedUsers?.[i] ?? 0)
                      .filter((_, i) => showVariations[i]),
                  ),
                ),
              ) * 1.03,
              Math.max(
                ...data.map((d) =>
                  Math.max(
                    ...variationNames
                      .map((_, i) => d?.users?.[i] ?? 0)
                      .filter((_, i) => showVariations[i]),
                    ...variationNames
                      .map((_, i) => d?.expectedUsers?.[i] ?? 0)
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
    [variationNames, mode, data, yMax, showVariations],
  );

  // Get x-axis domain
  const min =
    data.length > 0 ? Math.min(...data.map((d) => d.date.getTime())) : 0;
  const max =
    data.length > 0 ? Math.max(...data.map((d) => d.date.getTime())) : 0;

  return (
    <ParentSizeModern>
      {({ width }) => {
        const xMax = width - margin[1] - margin[3];

        const allXTicks = data.map((p) => p.date.getTime());

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
          const tooltipData = getTooltipData(containerX, width, data, xScale);
          if (!tooltipData) {
            hideTooltip();
            return;
          }
          showTooltip({
            tooltipLeft: tooltipData.x,
            tooltipTop: 0,
            tooltipData: tooltipData,
          });
        };

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
                  showVariations,
                )}
              </TooltipWithBounds>
            )}
            <div
              className="d-flex align-items-start"
              style={{
                justifyContent: "space-between",
              }}
            >
              <div
                className="d-flex flex-wrap align-items-start px-3 mb-2"
                style={{ gap: "0.25rem 1rem" }}
              >
                <div
                  key={"all"}
                  className="nowrap cursor-pointer hover-highlight py-1 pr-1 rounded user-select-none"
                  onClick={() => {
                    setShowVariations(variationNames.map(() => true));
                  }}
                >
                  {showVariations.every((sv) => sv) ? (
                    <BiRadioCircleMarked size={24} />
                  ) : (
                    <BiRadioCircle size={24} />
                  )}
                  Show all
                </div>
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
                        setShowVariations(
                          variationNames.map((_, j) => i === j),
                        );
                      }}
                    >
                      {showVariations[i] &&
                      !showVariations.every((sv) => sv) ? (
                        <BiRadioCircleMarked size={24} />
                      ) : (
                        <BiRadioCircle size={24} />
                      )}
                      {v}
                    </div>
                  );
                })}
              </div>
              <div
                className="box px-2 py-1"
                style={{
                  marginRight: 25,
                  marginTop: -10,
                  marginBottom: 0,
                  boxShadow: "0 2px 4px #0001",
                }}
              >
                <table className="table-tiny">
                  <tbody>
                    <tr>
                      <td>
                        <div
                          style={{
                            width: 15,
                            borderBottom: "2px solid var(--text-color-main)",
                          }}
                        />
                      </td>
                      <td>Actual</td>
                    </tr>
                    <tr>
                      <td>
                        <div
                          style={{
                            width: 15,
                            borderBottom: "2px dashed var(--text-color-main)",
                          }}
                        />
                      </td>
                      <td>Expected</td>
                    </tr>
                  </tbody>
                </table>
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
                <div
                  className={styles.crosshair}
                  style={{ transform: `translateX(${tooltipLeft}px)` }}
                />
              )}
            </div>
            <svg width={width} height={height}>
              <defs>
                <clipPath id="bandit-srm-graph-clip">
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
                  tickValues={mode !== "users" ? [0.25, 0.5, 0.75] : undefined}
                  numTicks={5}
                  stroke="var(--border-color-200)"
                />
                <GridColumns
                  scale={xScale}
                  stroke="var(--border-color-200)"
                  height={yMax}
                  tickValues={allXTicks}
                />

                <Group clipPath="url(#bandit-srm-graph-clip)">
                  {mode === "users"
                    ? variationNames.map((_, i) => {
                        if (!showVariations[i]) return null;
                        return (
                          <Fragment key={`users-group-${i}`}>
                            <LinePath
                              key={`linepath-expectedUsers-${i}`}
                              data={data}
                              x={(d) => xScale(d.date)}
                              y={(d) => yScale(d.expectedUsers?.[i] ?? 0)}
                              stroke={getVariationColor(i, true)}
                              strokeWidth={2}
                              strokeDasharray={"2,5"}
                              curve={curveMonotoneX}
                            />
                            <LinePath
                              key={`linepath-users-${i}`}
                              data={data}
                              x={(d) => xScale(d.date)}
                              y={(d) => yScale(d.users?.[i] ?? 0)}
                              stroke={getVariationColor(i, true)}
                              strokeWidth={2}
                              curve={curveMonotoneX}
                            />
                            <AreaClosed
                              key={`users-delta-${i}`}
                              yScale={yScale}
                              data={data}
                              x={(d) => xScale(d.date)}
                              y0={(d) => yScale(d.expectedUsers?.[i] ?? 0)}
                              y1={(d) => yScale(d.users?.[i] ?? 0)}
                              fill={getVariationColor(i, true)}
                              opacity={0.12}
                              curve={curveMonotoneX}
                            />
                          </Fragment>
                        );
                      })
                    : null}

                  {mode === "weights"
                    ? variationNames.map((_, i) => {
                        if (!showVariations[i]) return null;
                        return (
                          <Fragment key={`weights-group-${i}`}>
                            <LinePath
                              key={`linepath-weights-${i}`}
                              data={data}
                              x={(d) => xScale(d.date)}
                              y={(d) => yScale(d.weights?.[i] ?? 0)}
                              stroke={getVariationColor(i, true)}
                              strokeWidth={2}
                              curve={curveStepAfter}
                            />
                            <LinePath
                              key={`linepath-userRatios-${i}`}
                              data={data}
                              x={(d) => xScale(d.date)}
                              y={(d) => yScale(d.userRatios?.[i] ?? 0)}
                              stroke={getVariationColor(i, true)}
                              strokeWidth={2}
                              strokeDasharray={"2,5"}
                              curve={curveStepAfter}
                              defined={(d) => d.userRatios?.[i] !== undefined}
                            />
                            <AreaClosed
                              key={`weights-delta-${i}`}
                              yScale={yScale}
                              data={data}
                              x={(d) => xScale(d.date)}
                              y0={(d) => yScale(d.weights?.[i] ?? 0)}
                              y1={(d) => yScale(d.userRatios?.[i] ?? 0)}
                              fill={getVariationColor(i, true)}
                              opacity={0.12}
                              curve={curveStepAfter}
                              defined={(d) => d.userRatios?.[i] !== undefined}
                            />
                          </Fragment>
                        );
                      })
                    : null}
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
                <AxisLeft
                  scale={yScale}
                  stroke={"var(--text-color-table)"}
                  tickValues={
                    mode !== "users" ? [0, 0.25, 0.5, 0.75, 1] : undefined
                  }
                  numTicks={5}
                  labelOffset={40}
                  tickFormat={(v) =>
                    mode === "weights"
                      ? intPercentFormatter.format(v as number)
                      : formatter(v as number)
                  }
                  tickLabelProps={() => ({
                    fill: "var(--text-color-table)",
                    fontSize: 11,
                    textAnchor: "end",
                    dx: -5,
                    dy: 3,
                  })}
                  label={mode === "users" ? "Users" : "Traffic Split"}
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
export default BanditSRMGraph;
