import { MetricType } from "back-end/types/metric";
import { FC, useMemo } from "react";
import { formatConversionRate } from "../../services/metrics";
import { date } from "../../services/dates";
import { ParentSizeModern } from "@visx/responsive";
import { Group } from "@visx/group";
import { GridColumns, GridRows } from "@visx/grid";
import { scaleLinear, scaleTime } from "@visx/scale";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { LinePath } from "@visx/shape";
import { curveMonotoneX } from "@visx/curve";
import setDay from "date-fns/setDay";

const DateGraph: FC<{
  type: MetricType;
  groupby?: "day" | "week";
  dates: { d: Date; v: number; u?: number; s?: number }[];
}> = ({ type, dates, groupby = "day" }) => {
  const data = useMemo(
    () =>
      dates
        .reduce(
          (
            dates: { key: number; total: number; users: number }[],
            { d, v, u }
          ) => {
            const key = (groupby === "day"
              ? new Date(d)
              : setDay(new Date(d), 0)
            ).getTime();

            const users = u || 1;
            const total = v * users;

            for (let i = 0; i < dates.length; i++) {
              if (dates[i].key === key) {
                const clone = [...dates];
                clone[i] = {
                  key,
                  total: dates[i].total + total,
                  users: dates[i].users + users,
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
              },
            ];
          },
          []
        )
        .map((row) => {
          return {
            d: row.key,
            v: row.total / row.users,
          };
        }),
    [dates, groupby]
  );

  const height = 220;

  const min = Math.min(...data.map((d) => d.d));
  const max = Math.max(...data.map((d) => d.d));

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
          domain: [0, Math.max(...data.map((d) => d.v))],
          range: [yMax, 0],
          round: true,
        });

        const numXTicks = width > 768 ? 7 : 4;
        const numYTicks = 5;

        return (
          <svg width={width} height={height}>
            <Group left={margin[3]} top={margin[0]}>
              <GridRows scale={yScale} width={xMax} numTicks={numYTicks} />
              <GridColumns scale={xScale} height={yMax} numTicks={numXTicks} />

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
        );
      }}
    </ParentSizeModern>
  );
};
export default DateGraph;
