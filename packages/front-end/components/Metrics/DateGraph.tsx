import styles from "./DateGraph.module.scss";
import { MetricType } from "back-end/types/metric";
import { FC, useMemo } from "react";
import { formatConversionRate } from "../../services/metrics";
import { date } from "../../services/dates";
import { ParentSizeModern } from "@visx/responsive";
import { Group } from "@visx/group";
import { GridColumns, GridRows } from "@visx/grid";
import { scaleLinear, scaleTime } from "@visx/scale";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { AreaClosed, LinePath } from "@visx/shape";
import { curveMonotoneX } from "@visx/curve";
import {
  TooltipWithBounds,
  useTooltip,
  useTooltipInPortal,
} from "@visx/tooltip";
import setDay from "date-fns/setDay";

type TooltipData = { x: number; y: number; d: Datapoint };
interface Datapoint {
  d: Date | number;
  v: number;
  u?: number;
  s?: number;
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
    ((n - 1) * s2x + (m - 1) * s2y) / (t + 1) +
      (n * m * Math.pow(x - y, 2)) / (t * (t - 1))
  );
}

const DateGraph: FC<{
  type: MetricType;
  groupby?: "day" | "week";
  dates: Datapoint[];
}> = ({ type, dates, groupby = "day" }) => {
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
            u: row.users,
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
    const y = yScale(d.v) ?? 0;
    return { x, y, d };
  };

  const getTooltipContents = (d: Datapoint) => {
    return (
      <>
        <div className={styles.val}>
          {type !== "binomial" && <span>&mu;: </span>}
          {formatConversionRate(type, d.v as number)}
        </div>
        {type !== "binomial" && "s" in d && (
          <div className={styles.secondary}>
            &sigma;: {formatConversionRate(type, d.s)}
          </div>
        )}
        {"u" in d && (
          <div className={styles.secondary}>
            <em>n</em>: {d.u.toLocaleString()}
          </div>
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

  const height = 220;
  const margin = [15, 15, 30, 80];
  const min = Math.min(...data.map((d) => d.d));
  const max = Math.max(...data.map((d) => d.d));

  return (
    <ParentSizeModern>
      {({ width }) => {
        const yMax = height - margin[0] - margin[2];
        const xMax = width - margin[1] - margin[3];
        const numXTicks = width > 768 ? 7 : 4;
        const numYTicks = 5;

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
                <GridRows scale={yScale} width={xMax} numTicks={numYTicks} />
                <GridColumns
                  scale={xScale}
                  height={yMax}
                  numTicks={numXTicks}
                />

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
          </>
        );
      }}
    </ParentSizeModern>
  );
};
export default DateGraph;
