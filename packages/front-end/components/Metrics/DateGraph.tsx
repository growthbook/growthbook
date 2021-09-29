import Link from "next/link";
import { MetricType } from "back-end/types/metric";
import { FC, useState, useMemo } from "react";
import { formatConversionRate } from "../../services/metrics";
import { date } from "../../services/dates";
import { ParentSizeModern } from "@visx/responsive";
import { Group } from "@visx/group";
import { GridColumns, GridRows } from "@visx/grid";
import { scaleLinear, scaleTime } from "@visx/scale";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { AreaClosed, LinePath } from "@visx/shape";
import { Tooltip, defaultStyles as defaultTooltipStyles } from "@visx/tooltip";
import { curveMonotoneX } from "@visx/curve";
import setDay from "date-fns/setDay";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";

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
    ((n - 1) * s2x + (m - 1) * s2y) / (t + 1) +
      (n * m * Math.pow(x - y, 2)) / (t * (t - 1))
  );
}

type ExperimentDisplayData = {
  id: string;
  name: string;
  dateStarted?: string;
  dateEnded?: string;
  result?: string;
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
  dates: { d: Date; v: number; u?: number; s?: number }[];
  experiments?: Partial<ExperimentInterfaceStringDates>[];
  height?: number;
}> = ({ type, dates, groupby = "day", experiments = [], height = 220 }) => {
  const data = useMemo(
    () =>
      dates
        .reduce(
          (
            dates: {
              key: number;
              total: number;
              users: number;
              stddev: number;
            }[],
            { d, v, u, s }
          ) => {
            const key = (groupby === "day"
              ? new Date(d)
              : setDay(new Date(d), 0)
            ).getTime();

            const users = u || 1;
            const total = v * users;
            const stddev = s;

            for (let i = 0; i < dates.length; i++) {
              if (dates[i].key === key) {
                const clone = [...dates];
                clone[i] = {
                  key,
                  total: dates[i].total + total,
                  users: dates[i].users + users,
                  stddev: correctStddev(
                    dates[i].users,
                    dates[i].total / dates[i].users,
                    dates[i].stddev,
                    users,
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
                users,
                stddev,
              },
            ];
          },
          []
        )
        .map((row) => {
          return {
            d: row.key,
            v: row.total / row.users,
            s: row.stddev,
          };
        }),
    [dates, groupby]
  );

  const [toolTipTimer, setToolTipTimer] = useState<null | ReturnType<
    typeof setTimeout
  >>(null);
  const [
    highlightExp,
    setHighlightExp,
  ] = useState<null | ExperimentDisplayData>(null);

  const min = Math.min(...data.map((d) => d.d));
  const max = Math.max(...data.map((d) => d.d));

  // in future we might want to mark the different phases or percent traffic in this as different colors
  const experimentDates: ExperimentDisplayData[] = [];
  const bands = new Map();
  const toolTipDelay = 600;

  if (experiments) {
    experiments.forEach((e) => {
      if (e.status !== "draft") {
        const expLines: ExperimentDisplayData = {
          name: e.name,
          id: e.id,
          color: "rgb(136, 132, 216)",
          band: 0,
          result: e.results,
          opacity: highlightExp && highlightExp.id === e.id ? 1 : 0.35,
        };

        if (e.results === "won") {
          expLines.color = "rgba(20,206,134)";
        } else if (e.results === "lost") {
          expLines.color = "rgb(199,51,51)";
        }
        // get the earliest start date, and the latest end date - this might not be what we want,
        // we may want to only look at the 'main' phase, or ignore the holdouts.
        e.phases.forEach((p) => {
          if (!expLines.dateStarted) expLines.dateStarted = p.dateStarted;
          else if (p.dateStarted < expLines.dateStarted) {
            expLines.dateStarted = p.dateStarted;
          }
          if (!expLines.dateEnded) expLines.dateEnded = p.dateEnded;
          else if (p.dateEnded > expLines.dateEnded) {
            expLines.dateEnded = p.dateEnded;
          }
        });

        experimentDates.push(expLines);
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
        const margin = [15, 15, 30, 80];
        const yMax = height - margin[0] - margin[2];
        const xMax = width - margin[1] - margin[3];
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
              ...data.map((d) => Math.min(d.v * 2, d.v + (d.s ?? 0) * 2))
            ),
          ],
          range: [graphHeight, 0],
          round: true,
        });

        const numXTicks = width > 768 ? 7 : 4;
        const numYTicks = 5;

        return (
          <>
            <svg width={width} height={height}>
              <Group left={margin[3]} top={margin[0]}>
                <GridRows scale={yScale} width={xMax} numTicks={numYTicks} />
                <GridColumns
                  scale={xScale}
                  height={graphHeight}
                  numTicks={numXTicks}
                />
                {experiments && (
                  <>
                    {experimentDates.map((e) => {
                      if (highlightExp && e.id === highlightExp.id) {
                        return (
                          <rect
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
                {type !== "binomial" && (
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
                  y={(d) => yScale(d.v) ?? 0}
                  stroke={"#8884d8"}
                  strokeWidth={2}
                  curve={curveMonotoneX}
                />

                <AxisBottom
                  top={graphHeight}
                  scale={xScale}
                  numTicks={numXTicks}
                  tickFormat={(d) => {
                    return date(d as Date);
                  }}
                />
                <AxisLeft
                  scale={yScale}
                  numTicks={numYTicks}
                  tickFormat={(v) => formatConversionRate(type, v as number)}
                />
              </Group>
              {experiments && (
                <Group
                  left={margin[3]}
                  top={graphHeight + axisHeight + margin[0]}
                >
                  {experimentDates.map((e, i) => {
                    e.tipPosition = {
                      top: height,
                      left: xScale(
                        new Date(e.dateStarted).getTime() +
                          (new Date(e.dateEnded).getTime() -
                            new Date(e.dateStarted).getTime()) /
                            2
                      ),
                    };
                    return (
                      <rect
                        key={i}
                        fill={e.color}
                        x={xScale(new Date(e.dateStarted).getTime())}
                        y={e.band * (expBarHeight + expBarMargin)}
                        width={
                          xScale(new Date(e.dateEnded).getTime()) -
                          xScale(new Date(e.dateStarted).getTime())
                        }
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
                style={{
                  ...defaultTooltipStyles,
                  backgroundColor: "#283238",
                  color: "white",
                  zIndex: 9000,
                  pointerEvents: "all",
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
                <div style={{ color: "#fff", fontSize: "12px" }}>
                  <p className="mb-1">
                    <Link
                      href="/experiment/[eid]"
                      as={`/experiment/${highlightExp.id}`}
                    >
                      <a style={{ color: "#b3e8ff", fontSize: "12px" }}>
                        <strong>{highlightExp.name}</strong>
                      </a>
                    </Link>
                  </p>
                  <p className="mb-1">
                    {date(highlightExp.dateStarted)} -{" "}
                    {date(highlightExp.dateEnded)}
                  </p>
                  <p className="mb-1">
                    Result: <strong>{highlightExp.result}</strong>
                  </p>
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
