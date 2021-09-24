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

const DateGraph: FC<{
  type: MetricType;
  groupby?: "day" | "week";
  dates: { d: Date; v: number; u?: number; s?: number }[];
  experiments?: Partial<ExperimentInterfaceStringDates>[];
}> = ({ type, dates, groupby = "day", experiments = [] }) => {
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

  const [showToolTip, setShowToolTip] = useState(false);
  const [toolTipTimer, setToolTipTimer] = useState<null | ReturnType<
    typeof setTimeout
  >>(null);
  const [toolTipData, setToolTipData] = useState({
    name: "",
    id: "",
    dateStarted: "",
    dateEnded: "",
    top: 0,
    left: 0,
  });

  const height = 220;

  const min = Math.min(...data.map((d) => d.d));
  const max = Math.max(...data.map((d) => d.d));

  // in future we might want to mark the different phases or percent traffic in this as different colors
  const experimentDates = [];
  if (experiments) {
    experiments.forEach((e) => {
      if (e.status !== "draft") {
        const expLines: {
          name?: string;
          id?: string;
          dateStarted?: string;
          dateEnded?: string;
          color: string;
        } = { name: e.name, id: e.id, color: "#8884d858" };

        if (e.results === "won") {
          expLines.color = "rgba(20,206,134,0.35)";
        } else if (e.results === "lost") {
          expLines.color = "rgba(179,50,50,0.35)";
        }
        // get the earliest start date, and the latest end date - this might not be what we want,
        // we may want to only look at the 'main' phase.
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
  }

  return (
    <ParentSizeModern>
      {({ width }) => {
        const margin = [15, 15, 30, 80];
        const yMax = height - margin[0] - margin[2];
        const xMax = width - margin[1] - margin[3];

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
          range: [yMax, 0],
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
                  height={yMax}
                  numTicks={numXTicks}
                />
                {experimentDates.map((e, i) => {
                  // draw a block around the dates for each experiment
                  return (
                    <rect
                      key={i}
                      fill={e.color}
                      x={xScale(new Date(e.dateStarted).getTime())}
                      y={0}
                      width={
                        xScale(new Date(e.dateEnded).getTime()) -
                        xScale(new Date(e.dateStarted).getTime())
                      }
                      height={yMax}
                      onMouseOver={() => {
                        clearTimeout(toolTipTimer);
                        setToolTipData({
                          name: e.name,
                          id: e.id,
                          dateStarted: e.dateStarted,
                          dateEnded: e.dateEnded,
                          top: 40,
                          left: xScale(
                            new Date(e.dateStarted).getTime() +
                              (new Date(e.dateEnded).getTime() -
                                new Date(e.dateStarted).getTime()) /
                                2
                          ),
                        });
                        setShowToolTip(true);
                      }}
                      onMouseLeave={() => {
                        clearTimeout(toolTipTimer);
                        setToolTipTimer(setTimeout(setShowToolTip, 700, false));
                      }}
                    />
                  );
                })}

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
                  top={yMax}
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
            </svg>
            {showToolTip && toolTipData && (
              <Tooltip
                top={toolTipData.top}
                left={toolTipData.left}
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
                  setToolTipTimer(setTimeout(setShowToolTip, 700, false));
                }}
              >
                <div>
                  <Link
                    href="/experiment/[eid]"
                    as={`/experiment/${toolTipData.id}`}
                  >
                    <a style={{ color: "#b3e8ff", fontSize: "12px" }}>
                      <strong>{toolTipData.name}</strong>
                    </a>
                  </Link>
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
