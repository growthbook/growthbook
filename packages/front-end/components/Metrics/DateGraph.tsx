import Link from "next/link";
import { MetricType } from "back-end/types/metric";
import { FC, useState, useMemo, Fragment } from "react";
import { ParentSizeModern } from "@visx/responsive";
import { Group } from "@visx/group";
import { GridColumns, GridRows } from "@visx/grid";
import { scaleLinear, scaleTime } from "@visx/scale";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { AreaClosed, LinePath } from "@visx/shape";
import { curveMonotoneX } from "@visx/curve";
import {
  TooltipWithBounds,
  Tooltip,
  useTooltip,
  useTooltipInPortal,
} from "@visx/tooltip";
import setDay from "date-fns/setDay";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { date, getValidDate } from "@/services/dates";
import { formatConversionRate } from "@/services/metrics";
import styles from "./DateGraph.module.scss";

type TooltipData = { x: number; y: number; d: Datapoint };
interface Datapoint {
  d: Date | number;
  v: number;
  s?: number;
  c?: number;
}

function addStddev(
  value?: number,
  stddev?: number,
  num: number = 1,
  add: boolean = true
) {
  value = value ?? 0;
  stddev = stddev ?? 0;

  const err = stddev * num;

  return add ? value + err : Math.max(0, value - err);
}

function correctStddev(
  n: number,
  x: number,
  sx: number,
  m: number,
  y: number,
  sy: number
) {
  const s2x = Math.pow(sx, 2);
  const s2y = Math.pow(sy, 2);
  const t = n + m;

  return Math.sqrt(
    ((n - 1) * s2x + (m - 1) * s2y) / (t - 1) +
      (n * m * Math.pow(x - y, 2)) / (t * (t - 1))
  );
}

type ExperimentDisplayData = {
  id: string;
  name: string;
  dateStarted?: string;
  dateEnded?: string;
  status?: string;
  result?: string;
  analysis?: string;
  color?: string;
  band?: number;
  opacity?: number;
  tipPosition?: {
    top: number;
    left: number;
  };
};

const DateGraph: FC<{
  type: MetricType;
  groupby?: "day" | "week";
  dates: Datapoint[];
  showStdDev?: boolean;
  experiments?: Partial<ExperimentInterfaceStringDates>[];
  height?: number;
}> = ({
  type,
  dates,
  groupby = "day",
  showStdDev = true,
  experiments = [],
  height = 220,
}) => {
  const data = useMemo(
    () =>
      dates
        .reduce(
          (
            dates: {
              key: number;
              total: number;
              stddev: number;
              count: number;
            }[],
            { d, v, s, c }
          ) => {
            const key = (groupby === "day"
              ? getValidDate(d)
              : setDay(getValidDate(d), 0)
            ).getTime();

            const count = c || 1;
            const total = v * count;
            const stddev = s;

            for (let i = 0; i < dates.length; i++) {
              if (dates[i].key === key) {
                const clone = [...dates];
                clone[i] = {
                  key,
                  total: dates[i].total + total,
                  count: dates[i].count + count,
                  stddev: correctStddev(
                    dates[i].count,
                    dates[i].total / dates[i].count,
                    dates[i].stddev,
                    count,
                    v,
                    stddev
                  ),
                };
                return clone;
              }
            }

            return [
              ...dates,
              {
                key,
                total,
                count,
                stddev,
              },
            ];
          },
          []
        )
        .map((row) => {
          return {
            d: row.key,
            v: row.total / row.count,
            s: row.stddev,
            c: row.count,
          };
        }),
    [dates, groupby]
  );

  const getTooltipData = (mx: number, width: number, yScale): TooltipData => {
    const innerWidth = width - margin[1] - margin[3] + width / data.length - 1;
    const px = mx / innerWidth;
    const index = Math.max(
      Math.min(Math.round(px * data.length), data.length - 1),
      0
    );
    const d = data[index];
    const x = (data.length > 0 ? index / data.length : 0) * innerWidth;
    const y = yScale(type === "binomial" ? d.c : d.v) ?? 0;
    return { x, y, d };
  };

  const getTooltipContents = (d: Datapoint) => {
    return (
      <>
        {type === "binomial" ? (
          <div className={styles.val}>{d.c.toLocaleString()}</div>
        ) : (
          <>
            <div className={styles.val}>
              &mu;: {formatConversionRate(type, d.v as number)}
            </div>
            {"s" in d && (
              <div className={styles.secondary}>
                &sigma;: {formatConversionRate(type, d.s)}
              </div>
            )}
            <div className={styles.secondary}>
              <em>n</em>: {d.c.toLocaleString()}
            </div>
          </>
        )}
        <div className={styles.date}>{date(d.d as Date)}</div>
      </>
    );
  };

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

  const margin = [15, 15, 30, 80];
  const min = Math.min(...data.map((d) => d.d));
  const max = Math.max(...data.map((d) => d.d));

  const [toolTipTimer, setToolTipTimer] = useState<null | ReturnType<
    typeof setTimeout
  >>(null);
  const [
    highlightExp,
    setHighlightExp,
  ] = useState<null | ExperimentDisplayData>(null);

  // in future we might want to mark the different phases or percent traffic in this as different colors
  const experimentDates: ExperimentDisplayData[] = [];
  const bands = new Map();
  const toolTipDelay = 600;

  if (experiments && experiments.length > 0) {
    experiments.forEach((e) => {
      if (e.status !== "draft") {
        const expLines: ExperimentDisplayData = {
          name: e.name,
          id: e.id,
          color: "rgb(136, 132, 216)",
          band: 0,
          result: e.results,
          status: e.status,
          analysis: e.analysis,
          opacity: highlightExp && highlightExp.id === e.id ? 1 : 0.35,
        };

        if (e.status === "running") {
          expLines.color = "rgb(206,181,20)";
        }
        if (e.results === "won") {
          expLines.color = "rgba(20,206,134)";
        } else if (e.results === "lost") {
          expLines.color = "rgb(199,51,51)";
        }
        // get the earliest start date, and the latest end date - this might not be what we want,
        // we may want to only look at the 'main' phase, or ignore the holdouts.
        if (e?.phases) {
          e?.phases.forEach((p) => {
            if (!expLines.dateStarted) expLines.dateStarted = p.dateStarted;
            else if (p.dateStarted < expLines.dateStarted) {
              expLines.dateStarted = p.dateStarted;
            }
            if (!expLines.dateEnded) expLines.dateEnded = p.dateEnded;
            else if (p.dateEnded > expLines.dateEnded) {
              expLines.dateEnded = p.dateEnded;
            }
          });
        }
        // if an experiment is still running, it won't have an end date,
        // but we can still show it by setting the endDate to now.
        if (e.status === "running" && !expLines.dateEnded) {
          expLines.dateEnded = new Date().toISOString();
        }
        if (expLines.dateStarted && expLines.dateEnded) {
          experimentDates.push(expLines);
        }
      }
    });
    // get all the experiments in order of start date.
    experimentDates.sort((a, b) => {
      return a.dateStarted > b.dateStarted ? 1 : -1;
    });

    // get bands:
    experimentDates.forEach((ed) => {
      let curBandNum = 0;
      let placed = false;
      while (!placed) {
        const curBands = bands.get(curBandNum);
        if (!curBands) {
          ed.band = curBandNum;
          bands.set(curBandNum, [ed]);
          placed = true;
        } else {
          let fits = true;
          for (let i = 0; i < curBands.length; i++) {
            if (ed.dateStarted < curBands[i].dateEnded) {
              // it will not fit, there is an overlapping test.
              fits = false;
            }
          }
          if (fits) {
            ed.band = curBandNum;
            // append to the list:
            const tmp = bands.get(curBandNum);
            tmp.push(ed);
            bands.set(curBandNum, tmp);
            placed = true;
          } else {
            // doesn't fit, increase the band number and try again:
            curBandNum++;
          }
        }
      }
    });
  }

  return (
    <ParentSizeModern style={{ position: "relative" }}>
      {({ width }) => {
        const yMax = height - margin[0] - margin[2];
        const xMax = width - margin[1] - margin[3];
        const numXTicks = width > 768 ? 7 : 4;
        const numYTicks = 5;
        const axisHeight = 30;
        const minGraphHeight = 100;
        const expBarHeight = 10;
        const expBarMargin = 4;
        const expHeight = bands.size * (expBarHeight + expBarMargin);
        let graphHeight = yMax - expHeight;
        if (graphHeight < minGraphHeight) {
          height += minGraphHeight - (yMax - expHeight);
          graphHeight = minGraphHeight;
        }

        const xScale = scaleTime({
          domain: [min, max],
          range: [0, xMax],
          round: true,
        });
        const yScale = scaleLinear<number>({
          domain: [
            0,
            Math.max(
              ...data.map((d) =>
                type === "binomial"
                  ? d.c
                  : Math.min(d.v * 2, d.v + (d.s ?? 0) * 2)
              )
            ),
          ],
          range: [graphHeight, 0],
          round: true,
        });

        const handlePointer = (event: React.PointerEvent<HTMLDivElement>) => {
          // coordinates should be relative to the container in which Tooltip is rendered
          const containerX =
            ("clientX" in event ? event.clientX : 0) - containerBounds.left;
          const data = getTooltipData(containerX, width, yScale);
          showTooltip({
            tooltipLeft: data.x,
            tooltipTop: data.y,
            tooltipData: data,
          });
        };

        return (
          <>
            <div
              ref={containerRef}
              className={styles.tooltipDategraph}
              style={{
                width: xMax,
                height: graphHeight,
                marginLeft: margin[3],
                marginTop: margin[0],
              }}
              onPointerMove={handlePointer}
              onPointerLeave={hideTooltip}
            >
              {tooltipOpen && (
                <>
                  <div
                    className={styles.positionIndicator}
                    style={{
                      transform: `translate(${tooltipLeft}px, ${tooltipTop}px)`,
                    }}
                  />
                  <div
                    className={styles.crosshair}
                    style={{ transform: `translateX(${tooltipLeft}px)` }}
                  />
                  <TooltipWithBounds
                    left={tooltipLeft}
                    top={tooltipTop}
                    className={styles.tooltip}
                    unstyled={true}
                  >
                    {getTooltipContents(tooltipData.d)}
                  </TooltipWithBounds>
                </>
              )}
            </div>
            <svg width={width} height={height}>
              <Group left={margin[3]} top={margin[0]}>
                <GridRows
                  scale={yScale}
                  width={xMax}
                  numTicks={numYTicks}
                  stroke="var(--border-color-200)"
                />
                <GridColumns
                  scale={xScale}
                  height={graphHeight}
                  numTicks={numXTicks}
                  stroke="var(--border-color-200)"
                />
                {experiments && (
                  <>
                    {experimentDates.map((e) => {
                      if (highlightExp && e.id === highlightExp.id) {
                        return (
                          <rect
                            key={e.id}
                            fill={e.color}
                            x={xScale(new Date(e.dateStarted).getTime())}
                            y={0}
                            width={
                              xScale(new Date(e.dateEnded).getTime()) -
                              xScale(new Date(e.dateStarted).getTime())
                            }
                            style={{ opacity: 0.15 }}
                            height={graphHeight}
                            onMouseOver={() => {
                              clearTimeout(toolTipTimer);
                            }}
                            onMouseLeave={() => {
                              clearTimeout(toolTipTimer);
                              setToolTipTimer(
                                setTimeout(setHighlightExp, toolTipDelay, null)
                              );
                            }}
                          />
                        );
                      }
                    })}
                  </>
                )}
                {showStdDev && type !== "binomial" && (
                  <>
                    <AreaClosed
                      yScale={yScale}
                      data={data}
                      x={(d) => xScale(d.d) ?? 0}
                      y0={(d) => yScale(addStddev(d.v, d.s, 2, false))}
                      y1={(d) => yScale(addStddev(d.v, d.s, 2, true))}
                      fill={"#dddddd"}
                      opacity={0.5}
                      curve={curveMonotoneX}
                    />
                    <AreaClosed
                      yScale={yScale}
                      data={data}
                      x={(d) => xScale(d.d) ?? 0}
                      y0={(d) => yScale(addStddev(d.v, d.s, 1, false))}
                      y1={(d) => yScale(addStddev(d.v, d.s, 1, true))}
                      fill={"#cccccc"}
                      opacity={0.5}
                      curve={curveMonotoneX}
                    />
                  </>
                )}

                <LinePath
                  data={data}
                  x={(d) => xScale(d.d) ?? 0}
                  y={(d) => yScale(type === "binomial" ? d.c : d.v) ?? 0}
                  stroke={"#8884d8"}
                  strokeWidth={2}
                  curve={curveMonotoneX}
                />

                <AxisBottom
                  top={graphHeight}
                  scale={xScale}
                  numTicks={numXTicks}
                  tickLabelProps={() => ({
                    fill: "var(--text-color-table)",
                    fontSize: 11,
                    textAnchor: "start",
                    dx: -15,
                  })}
                  tickFormat={(d) => {
                    return (d as Date).toLocaleDateString("en-us", {
                      month: "short",
                      day: "numeric",
                    });
                  }}
                />
                <AxisLeft
                  scale={yScale}
                  numTicks={numYTicks}
                  tickLabelProps={() => ({
                    fill: "var(--text-color-table)",
                    fontSize: 11,
                    textAnchor: "end",
                    dx: -2,
                    dy: 2,
                  })}
                  tickFormat={(v) =>
                    type === "binomial"
                      ? (v as number).toLocaleString()
                      : formatConversionRate(type, v as number)
                  }
                />
              </Group>
              {experiments && (
                <Group
                  left={margin[3]}
                  top={graphHeight + axisHeight + margin[0]}
                >
                  {experimentDates.map((e, i) => {
                    const rectWidth =
                      xScale(new Date(e.dateEnded).getTime()) -
                      xScale(new Date(e.dateStarted).getTime());
                    e.tipPosition = {
                      top: height,
                      left:
                        xScale(new Date(e.dateStarted).getTime()) +
                        Math.min(150, rectWidth / 2),
                    };

                    // as this is loading, xScale may return negative numbers, which throws errors in <rect>.
                    if (rectWidth <= 0) return <Fragment key={i} />;
                    return (
                      <rect
                        key={i}
                        fill={e.color}
                        x={xScale(new Date(e.dateStarted).getTime())}
                        y={e.band * (expBarHeight + expBarMargin)}
                        width={rectWidth}
                        style={{ opacity: e.opacity }}
                        rx={4}
                        height={expBarHeight}
                        onMouseOver={() => {
                          clearTimeout(toolTipTimer);
                          setHighlightExp(e);
                        }}
                        onMouseLeave={() => {
                          clearTimeout(toolTipTimer);
                          setToolTipTimer(
                            setTimeout(setHighlightExp, toolTipDelay, null)
                          );
                        }}
                      />
                    );
                  })}
                </Group>
              )}
            </svg>
            {highlightExp && (
              <Tooltip
                top={highlightExp.tipPosition.top}
                left={highlightExp.tipPosition.left}
                className={styles.tooltip}
                style={{
                  position: "absolute",
                  color: "white",
                  zIndex: 9000,
                }}
                onMouseOver={() => {
                  clearTimeout(toolTipTimer);
                }}
                onMouseLeave={() => {
                  clearTimeout(toolTipTimer);
                  setToolTipTimer(
                    setTimeout(setHighlightExp, toolTipDelay, null)
                  );
                }}
              >
                <div
                  style={{ color: "#fff", fontSize: "12px", maxWidth: "250px" }}
                >
                  <p className="mb-1">
                    <Link href={`/experiment/${highlightExp.id}`}>
                      <a style={{ color: "#b3e8ff", fontSize: "12px" }}>
                        <strong>{highlightExp.name}</strong>
                      </a>
                    </Link>
                  </p>
                  <p className="mb-1">
                    {date(highlightExp.dateStarted)} -{" "}
                    {highlightExp.status === "running"
                      ? ""
                      : date(highlightExp.dateEnded)}
                  </p>
                  <p className="mb-1">
                    {highlightExp.status === "running" ? (
                      <>
                        Status:{" "}
                        <i>
                          <strong>{highlightExp.status}</strong>
                        </i>
                      </>
                    ) : (
                      <>
                        Result: <strong>{highlightExp.result}</strong>
                      </>
                    )}
                  </p>
                  <p className="mb-1">{highlightExp.analysis}</p>
                </div>
              </Tooltip>
            )}
          </>
        );
      }}
    </ParentSizeModern>
  );
};
export default DateGraph;
