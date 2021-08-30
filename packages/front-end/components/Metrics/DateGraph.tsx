import { MetricType } from "back-end/types/metric";
import { FC } from "react";
import { formatConversionRate } from "../../services/metrics";
import { date } from "../../services/dates";
import { ParentSizeModern } from "@visx/responsive";
import { Group } from "@visx/group";
import { GridColumns, GridRows } from "@visx/grid";
import { scaleLinear, scaleTime } from "@visx/scale";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { LinePath } from "@visx/shape";
import { curveMonotoneX } from "@visx/curve";

const DateGraph: FC<{
  type: MetricType;
  dates: { d: Date; v: number }[];
}> = ({ type, dates }) => {
  const data = dates.map(({ d, v }) => {
    return {
      d: new Date(d).getTime(),
      v,
    };
  });

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
