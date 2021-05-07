import { MetricType } from "back-end/types/metric";
import { FC } from "react";
import {
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
  AreaChart,
  Area,
  CartesianGrid,
} from "recharts";
import {
  formatConversionRate,
  getMetricConversionTitle,
} from "../../services/MetricsContext";

const DistributionGraph: FC<{
  type: MetricType;
  percentiles: { p: number; v: number }[];
}> = ({ type, percentiles }) => {
  percentiles.sort((a, b) => a.p - b.p);

  const max = Math.max(...percentiles.map((p) => p.v));

  return (
    <ResponsiveContainer height={220} width={"100%"}>
      <AreaChart data={percentiles}>
        <YAxis
          tickFormatter={(payload) => {
            return parseFloat((payload * 100).toFixed(1)) + "%";
          }}
          width={75}
          label={{
            value: "Percentile",
            angle: -90,
            position: "insideBottomLeft",
            offset: 15,
          }}
          ticks={[0.25, 0.5, 0.75, 1]}
        />
        <XAxis
          tickFormatter={(payload) => {
            return formatConversionRate(type, payload);
          }}
          dataKey="v"
          type="number"
          height={50}
          label={{
            value: getMetricConversionTitle(type),
            position: "insideBottom",
            offset: 0,
          }}
          domain={[0, max]}
        />
        <Area
          type="monotone"
          strokeWidth={0}
          dataKey="p"
          stroke="#8884d8"
          fill="#8884d8"
        />
        <CartesianGrid />
        <Tooltip
          formatter={(value) => {
            return [
              parseFloat(((value as number) * 100).toFixed(1)) +
                (value === 0.01 ? "st Percentile" : "th Percentile"),
            ];
          }}
          labelFormatter={(label) => {
            return (
              <strong>{formatConversionRate(type, label as number)}</strong>
            );
          }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
};
export default DistributionGraph;
