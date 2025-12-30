import Link from "next/link";
import { MetricType } from "shared/types/metric";
import { FC, Fragment, useEffect, useMemo, useState } from "react";
import { ParentSizeModern } from "@visx/responsive";
import { Group } from "@visx/group";
import { GridColumns, GridRows } from "@visx/grid";
import { scaleLinear, scaleTime } from "@visx/scale";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { AreaClosed, LinePath } from "@visx/shape";
import { curveMonotoneX } from "@visx/curve";
import {
  Tooltip,
  TooltipWithBounds,
  useTooltip,
  useTooltipInPortal,
} from "@visx/tooltip";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { date, getValidDate, getValidDateOffsetByUTC } from "shared/dates";
import { addDays, setHours, setMinutes } from "date-fns";
import cloneDeep from "lodash/cloneDeep";
import { ScaleLinear } from "d3-scale";
import { getMetricFormatter } from "@/services/metrics";
import { useCurrency } from "@/hooks/useCurrency";
import styles from "./DateGraph.module.scss";

interface Datapoint {
  d: Date | number;
  v: number | null; // value
  s?: number | null; // standard deviation
  c?: number | null; // count
  num?: number | null; // numerator
  den?: number | null; // denominator
  oor?: boolean; // out of range
}

type TooltipData = { x: number; y: number; d: Datapoint };

function getDatapointFromDate(date: number, data: Datapoint[]) {
  // find the closest datapoint to the date
  const datapoint = data.reduce((acc, cur) => {
    const curDate = getValidDate(cur.d).getTime();
    const accDate = getValidDate(acc.d).getTime();
    return Math.abs(curDate - date) < Math.abs(accDate - date) ? cur : acc;
  });
  // if it's within 1 day, return it
  if (Math.abs(getValidDate(datapoint.d).getTime() - date) < 86400000) {
    return datapoint;
  }
  return null;
}

function getTooltipDataFromDatapoint(
  datapoint: Datapoint,
  data: Datapoint[],
  innerWidth: number,
  yScale: ScaleLinear<unknown, unknown, never>,
) {
  const index = data.indexOf(datapoint);
  if (index === -1) {
    return null;
  }
  const x = (data.length > 0 ? index / data.length : 0) * innerWidth;
  const y = (yScale(datapoint.v ?? 0) ?? 0) as number;
  return { x, y, d: datapoint };
}

function getDateFromX(
  x: number,
  data: Datapoint[],
  width: number,
  marginLeft: number,
  marginRight: number,
) {
  const innerWidth = width - marginRight - marginLeft + width / data.length - 1;
  const px = x / innerWidth;
  const index = Math.max(
    Math.min(Math.round(px * data.length), data.length - 1),
    0,
  );
  const datapoint = data[index];
  return getValidDate(datapoint.d).getTime();
}

function getTooltipContents(
  d: Datapoint,
  type: MetricType,
  method: "sum" | "avg",
  smoothBy: "day" | "week",
  formatter: (value: number, options?: Intl.NumberFormatOptions) => string,
  displayCurrency?: string,
) {
  if (!d || d.oor) return null;
  const formatterOptions = { currency: displayCurrency };
  return (
    <>
      {type === "binomial" ? (
        <div className={styles.val}>
          <em>n</em>: {Math.round(d.v ?? 0)}
          {smoothBy === "week" && (
            <sub style={{ fontWeight: "normal", fontSize: 8 }}> smooth</sub>
          )}
        </div>
      ) : (
        <>
          <div className={styles.val}>
            {method === "sum" ? `Σ` : `μ`}:{" "}
            {formatter(d.v as number, formatterOptions)}
            {smoothBy === "week" && (
              <sub style={{ fontWeight: "normal", fontSize: 8 }}> smooth</sub>
            )}
          </div>
          {"s" in d && method === "avg" && (
            <div className={styles.secondary}>
              {`σ`}: {formatter(d.s || 0, formatterOptions)}
              {smoothBy === "week" && (
                <sub style={{ fontWeight: "normal", fontSize: 8 }}> smooth</sub>
              )}
            </div>
          )}
          <div className={styles.secondary}>
            <em>n</em>: {d.c && Math.round(d.c)}
          </div>
        </>
      )}
      <div className={styles.date}>{date(d.d as Date)}</div>
    </>
  );
}

function addStddev(
  value?: number,
  stddev?: number,
  num: number = 1,
  add: boolean = true,
) {
  value = value ?? 0;
  stddev = stddev ?? 0;
  const err = stddev * num;

  return add ? value + err : Math.max(0, value - err);
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

interface DateGraphProps {
  type: MetricType;
  smoothBy?: "day" | "week";
  method?: "avg" | "sum";
  dates: Datapoint[];
  showStdDev?: boolean;
  experiments?: ExperimentInterfaceStringDates[];
  height?: number;
  margin?: [number, number, number, number];
  formatter?: (value: number, options?: Intl.NumberFormatOptions) => string;
  onHover?: (ret: { d: number | null }) => void;
  hoverDate?: number | null;
}

const DateGraph: FC<DateGraphProps> = ({
  type,
  smoothBy = "day",
  method = "avg",
  dates,
  showStdDev = true,
  experiments = [],
  height = 220,
  margin = [15, 15, 30, 80],
  formatter,
  onHover,
  hoverDate,
}: DateGraphProps) => {
  const [marginTop, marginRight, marginBottom, marginLeft] = margin;

  const displayCurrency = useCurrency();
  const metricFormatter = formatter ?? getMetricFormatter(type);
  const formatterOptions = { currency: displayCurrency };

  const [highlightExp, setHighlightExp] =
    useState<null | ExperimentDisplayData>(null);

  const data = useMemo(() => {
    let sortedDates = cloneDeep(dates).sort(
      (a, b) => getValidDate(a.d).getTime() - getValidDate(b.d).getTime(),
    );

    // Force a common date format using the last date
    const lastDate = getValidDate(sortedDates[sortedDates.length - 1].d);
    const desiredHour = lastDate.getUTCHours();
    const desiredMinute = lastDate.getUTCMinutes();
    sortedDates = sortedDates.map((d) => {
      let date = getValidDateOffsetByUTC(d.d);
      date = setMinutes(setHours(date, desiredHour), desiredMinute);
      d.d = date;
      return d;
    });

    // Insert missing dates
    const filledDates: Datapoint[] = [];
    for (let i = 0; i < sortedDates.length; i++) {
      filledDates.push(sortedDates[i]);
      if (i < sortedDates.length - 1) {
        const currentDate = getValidDate(sortedDates[i].d);
        const nextDate = getValidDate(sortedDates[i + 1].d);
        let expectedDate = addDays(new Date(currentDate), 1);

        while (expectedDate < nextDate) {
          filledDates.push({
            d: expectedDate,
            v: null,
            s: null,
            c: 0,
          });
          expectedDate = addDays(expectedDate, 1);
        }
      }
    }

    // Calculate data points
    return filledDates.map((row, i) => {
      const key = getValidDate(row.d).getTime();
      let value =
        row.v === null ? null : method === "avg" ? row.v : row.v * (row.c ?? 1);
      let stddev = row.s === null ? null : method === "avg" ? row.s : 0;
      const count = row.c === null ? null : (row.c ?? 1);
      const oor = row.oor;

      if (smoothBy === "week") {
        // get 7 day average (or < 7 days if at beginning of data)
        const windowedDates = filledDates.slice(Math.max(i - 6, 0), i + 1);
        const filteredWindowedDates = windowedDates.filter(
          (d) => d.v !== null && d.s !== null,
        );
        const days = filteredWindowedDates.length;
        const sumValue = filteredWindowedDates.reduce((acc, cur) => {
          if (cur.v === null) return null;
          return acc + (method === "avg" ? cur.v : cur.v * (cur.c ?? 1));
        }, 0);
        const sumStddev = filteredWindowedDates.reduce((acc, cur) => {
          if (cur.s === null) return null;
          return acc + (method === "avg" ? (cur.s ?? 0) : 0);
        }, 0);
        if (sumValue !== null && sumStddev !== null) {
          value = days ? sumValue / days : 0;
          stddev = days ? sumStddev / days : 0;
        }
        if (row.v === null || row.s === null) {
          value = null;
          stddev = null;
        }
      }

      const ret: Datapoint = {
        d: key,
        v: value,
        s: stddev,
        c: count,
      };
      if (oor) {
        ret.oor = true;
      }
      if (smoothBy === "week" && i < 6) {
        ret.oor = true;
      }
      return ret;
    });
  }, [dates, smoothBy, method]);

  const toolTipDelay = 600;

  // in future we might want to mark the different phases or percent traffic in this as different colors
  const experimentDates: ExperimentDisplayData[] = [];
  const bands = new Map();

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
        // get the earliest start date, and the latest end date.
        if (e?.phases) {
          e?.phases.forEach((p) => {
            if (!expLines.dateStarted) expLines.dateStarted = p.dateStarted;
            else if (p.dateStarted && p.dateStarted < expLines.dateStarted) {
              expLines.dateStarted = p.dateStarted;
            }
            if (!expLines.dateEnded) expLines.dateEnded = p.dateEnded;
            else if (p.dateEnded && p.dateEnded > expLines.dateEnded) {
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
      if (!a.dateStarted || !b.dateStarted) return 0;

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
            if (ed.dateStarted && ed.dateStarted < curBands[i].dateEnded) {
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

  const { containerRef, containerBounds } = useTooltipInPortal({
    scroll: true,
    detectBounds: true,
  });

  const width = (containerBounds?.width || 0) + marginRight + marginLeft;
  const dateNums = data.map((d) => getValidDate(d.d).getTime());
  const min = Math.min(...dateNums);
  const max = Math.max(...dateNums);
  const yMax = height - marginTop - marginBottom;
  const xMax = containerBounds?.width || 0;
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

  const xScale = useMemo(
    () =>
      scaleTime({
        domain: [min, max],
        range: [0, xMax],
        round: true,
      }),
    [min, max, xMax],
  );

  const yScale = useMemo(
    () =>
      scaleLinear<number>({
        domain: [
          0,
          Math.max(
            ...data.map((d) =>
              Math.min((d.v ?? 0) * 2, (d.v ?? 0) + (d.s ?? 0) * 2),
            ),
          ),
        ],
        range: [graphHeight, 0],
        round: true,
      }),
    [data, graphHeight],
  );

  const {
    showTooltip,
    hideTooltip,
    tooltipOpen,
    tooltipData,
    tooltipLeft = 0,
    tooltipTop = 0,
  } = useTooltip<TooltipData>();

  const [toolTipTimer, setToolTipTimer] = useState<
    undefined | ReturnType<typeof setTimeout>
  >();

  useEffect(() => {
    if (!hoverDate) {
      hideTooltip();
      return;
    }
    const datapoint = getDatapointFromDate(hoverDate, data);
    if (!datapoint || datapoint.oor || datapoint.v === null) {
      hideTooltip();
      return;
    }
    const innerWidth =
      width - marginLeft - marginRight + width / data.length - 1;
    const tooltipData = getTooltipDataFromDatapoint(
      datapoint,
      data,
      innerWidth,
      yScale,
    );
    if (!tooltipData) {
      hideTooltip();
      return;
    }
    showTooltip({
      tooltipLeft: tooltipData.x,
      tooltipTop: tooltipData.y,
      tooltipData: tooltipData,
    });
  }, [
    hoverDate,
    data,
    width,
    marginLeft,
    marginRight,
    yScale,
    showTooltip,
    hideTooltip,
  ]);

  return (
    <ParentSizeModern style={{ position: "relative" }}>
      {({ width }) => {
        const xMax = width - marginRight - marginLeft;

        const handlePointerMove = (
          event: React.PointerEvent<HTMLDivElement>,
        ) => {
          // coordinates should be relative to the container in which Tooltip is rendered
          const containerX =
            ("clientX" in event ? event.clientX : 0) - containerBounds.left;
          const date = getDateFromX(
            containerX,
            data,
            width,
            marginLeft,
            marginRight,
          );
          if (onHover) {
            onHover({ d: date });
          }
        };

        const handlePointerLeave = () => {
          hideTooltip();
          if (onHover) {
            onHover({ d: null });
          }
        };

        return (
          <>
            <div
              ref={containerRef}
              className={styles.tooltipDategraph}
              style={{
                width: xMax,
                height: graphHeight,
                marginLeft: marginLeft,
                marginTop: marginTop,
              }}
              onPointerMove={handlePointerMove}
              onPointerLeave={handlePointerLeave}
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
                    {tooltipData?.d &&
                      getTooltipContents(
                        tooltipData.d,
                        type,
                        method,
                        smoothBy,
                        metricFormatter,
                        displayCurrency,
                      )}
                  </TooltipWithBounds>
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
                  <rect fill="#cccccc" width="2.5" height="6" />
                  <rect fill="#d6d6d6" x="2.5" width="3.5" height="6" />
                </pattern>
                <clipPath id="date-graph-clip">
                  <rect
                    x={0}
                    y={0}
                    width={Math.max(0, width - margin[1] - margin[3])}
                    height={Math.max(0, height - margin[0] - margin[2])}
                  />
                </clipPath>
              </defs>
              <Group left={marginLeft} top={marginTop}>
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
                            x={
                              e.dateStarted
                                ? xScale(new Date(e.dateStarted).getTime())
                                : 0
                            }
                            y={0}
                            width={
                              e.dateEnded && e.dateStarted
                                ? xScale(new Date(e.dateEnded).getTime()) -
                                  xScale(new Date(e.dateStarted).getTime())
                                : 0
                            }
                            style={{ opacity: 0.15 }}
                            height={graphHeight}
                            onMouseOver={() => {
                              clearTimeout(toolTipTimer);
                            }}
                            onMouseLeave={() => {
                              clearTimeout(toolTipTimer);
                              setToolTipTimer(
                                setTimeout(setHighlightExp, toolTipDelay, null),
                              );
                            }}
                          />
                        );
                      }
                    })}
                  </>
                )}

                <Group clipPath="url(#date-graph-clip)">
                  {showStdDev && type !== "binomial" && (
                    <>
                      <AreaClosed
                        yScale={yScale}
                        data={data}
                        x={(d) => xScale(d.d) ?? 0}
                        y0={(d) =>
                          yScale(addStddev(d.v ?? 0, d.s ?? 0, 2, false))
                        }
                        y1={(d) =>
                          yScale(addStddev(d.v ?? 0, d.s ?? 0, 2, true))
                        }
                        fill={"#dddddd"}
                        opacity={0.5}
                        defined={(d) => d.s !== null && !d?.oor}
                        curve={curveMonotoneX}
                      />
                      <AreaClosed
                        yScale={yScale}
                        data={data}
                        x={(d) => xScale(d.d) ?? 0}
                        y0={(d) =>
                          yScale(addStddev(d.v ?? 0, d.s ?? 0, 1, false))
                        }
                        y1={(d) =>
                          yScale(addStddev(d.v ?? 0, d.s ?? 0, 1, true))
                        }
                        fill={"#cccccc"}
                        opacity={0.5}
                        defined={(d) => d.s !== null && !d?.oor}
                        curve={curveMonotoneX}
                      />

                      {smoothBy === "week" && (
                        <>
                          <AreaClosed
                            yScale={yScale}
                            data={data}
                            x={(d) => xScale(d.d) ?? 0}
                            y0={(d) =>
                              yScale(addStddev(d.v ?? 0, d.s ?? 0, 2, false))
                            }
                            y1={(d) =>
                              yScale(addStddev(d.v ?? 0, d.s ?? 0, 2, true))
                            }
                            fill={"url(#stripe-pattern)"}
                            opacity={0.3}
                            defined={(d, i) =>
                              d.s !== null && !!(d?.oor || data?.[i - 1]?.oor)
                            }
                            curve={curveMonotoneX}
                          />
                          <AreaClosed
                            yScale={yScale}
                            data={data}
                            x={(d) => xScale(d.d) ?? 0}
                            y0={(d) =>
                              yScale(addStddev(d.v ?? 0, d.s ?? 0, 1, false))
                            }
                            y1={(d) =>
                              yScale(addStddev(d.v ?? 0, d.s ?? 0, 1, true))
                            }
                            fill={"url(#stripe-pattern)"}
                            opacity={0.3}
                            defined={(d, i) =>
                              d.s !== null && !!(d?.oor || data?.[i - 1]?.oor)
                            }
                            curve={curveMonotoneX}
                          />
                        </>
                      )}
                    </>
                  )}

                  <LinePath
                    data={data}
                    x={(d) => xScale(d.d) ?? 0}
                    y={(d) => yScale(d.v ?? 0) ?? 0}
                    stroke={"#8884d8"}
                    strokeWidth={2}
                    curve={curveMonotoneX}
                    defined={(d) => d.v !== null && !d?.oor}
                  />
                  {smoothBy === "week" && (
                    <LinePath
                      data={data}
                      x={(d) => xScale(d.d) ?? 0}
                      y={(d) => yScale(d.v ?? 0) ?? 0}
                      stroke={"#8884d8"}
                      opacity={0.5}
                      strokeDasharray={"2,5"}
                      strokeWidth={2}
                      curve={curveMonotoneX}
                      defined={(d, i) =>
                        d.v !== null && !!(d?.oor || data?.[i - 1]?.oor)
                      }
                    />
                  )}
                </Group>

                <AxisBottom
                  top={graphHeight}
                  scale={xScale}
                  stroke={"var(--text-color-table)"}
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
                  stroke={"var(--text-color-table)"}
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
                      : metricFormatter(v as number, formatterOptions)
                  }
                />
              </Group>
              {experiments && (
                <Group
                  left={marginLeft}
                  top={graphHeight + axisHeight + marginTop}
                >
                  {experimentDates.map((e, i) => {
                    const rectWidth =
                      e.dateEnded && e.dateStarted
                        ? xScale(new Date(e.dateEnded).getTime()) -
                          xScale(new Date(e.dateStarted).getTime())
                        : 0;
                    e.tipPosition = {
                      top: height,
                      left: e.dateStarted
                        ? xScale(new Date(e.dateStarted).getTime()) +
                          Math.min(150, rectWidth / 2)
                        : 0,
                    };

                    // as this is loading, xScale may return negative numbers, which throws errors in <rect>.
                    if (rectWidth <= 0) return <Fragment key={i} />;
                    return (
                      <rect
                        key={i}
                        fill={e.color}
                        x={
                          e.dateStarted
                            ? xScale(new Date(e.dateStarted).getTime())
                            : 0
                        }
                        y={e.band ? e.band * (expBarHeight + expBarMargin) : 0}
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
                            setTimeout(setHighlightExp, toolTipDelay, null),
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
                top={highlightExp.tipPosition?.top}
                left={highlightExp.tipPosition?.left}
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
                    setTimeout(setHighlightExp, toolTipDelay, null),
                  );
                }}
              >
                <div
                  style={{ color: "#fff", fontSize: "12px", maxWidth: "250px" }}
                >
                  <p className="mb-1">
                    <Link
                      href={`/experiment/${highlightExp.id}`}
                      style={{ color: "#b3e8ff", fontSize: "12px" }}
                    >
                      <strong>{highlightExp.name}</strong>
                    </Link>
                  </p>
                  <p className="mb-1">
                    {highlightExp.dateStarted
                      ? date(highlightExp.dateStarted)
                      : ""}{" "}
                    -{" "}
                    {highlightExp.status === "running" ||
                    !highlightExp.dateEnded
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
