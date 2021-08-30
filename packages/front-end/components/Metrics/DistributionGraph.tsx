import { MetricType } from "back-end/types/metric";
import { FC } from "react";
import { formatConversionRate } from "../../services/metrics";
import { ParentSizeModern } from "@visx/responsive";
import { Group } from "@visx/group";
import { GridColumns, GridRows } from "@visx/grid";
import { scaleLinear } from "@visx/scale";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { AreaClosed } from "@visx/shape";
import { curveMonotoneX } from "@visx/curve";

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

const DistributionGraph: FC<{
  type: MetricType;
  percentiles: { p: number; v: number }[];
}> = ({ type, percentiles }) => {
  percentiles.sort((a, b) => a.p - b.p);

  const height = 220;

  const max = Math.max(...percentiles.map((d) => d.v));

  return (
    <ParentSizeModern>
      {({ width }) => {
        const margin = [15, 15, 30, 80];
        const yMax = height - margin[0] - margin[2];
        const xMax = width - margin[1] - margin[3];

        const xScale = scaleLinear({
          domain: [0, max],
          range: [0, xMax],
          round: true,
        });
        const yScale = scaleLinear<number>({
          domain: [0, 1],
          range: [yMax, 0],
          round: true,
        });

        const numXTicks = width > 768 ? 7 : 4;

        return (
          <svg width={width} height={height}>
            <Group left={margin[3]} top={margin[0]}>
              <GridRows scale={yScale} width={xMax} />
              <GridColumns scale={xScale} height={yMax} numTicks={numXTicks} />

              <AreaClosed
                data={percentiles}
                x={(d) => xScale(d.v) ?? 0}
                y={(d) => yScale(d.p) ?? 0}
                yScale={yScale}
                fill="#8884d8"
                strokeWidth={0}
                curve={curveMonotoneX}
                opacity={0.6}
              />

              <AxisBottom
                top={yMax}
                scale={xScale}
                numTicks={numXTicks}
                tickFormat={(d) => {
                  return formatConversionRate(type, d as number);
                }}
              />
              <AxisLeft
                scale={yScale}
                numTicks={4}
                tickFormat={(d) => percentFormatter.format(d as number)}
              />
            </Group>
          </svg>
        );
      }}
    </ParentSizeModern>
  );
};
export default DistributionGraph;
