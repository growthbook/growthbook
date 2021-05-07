import { MetricType } from "back-end/types/metric";
import { FC } from "react";
import {
  XAxis,
  YAxis,
  LineChart,
  Line,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import {
  formatConversionRate,
  getMetricConversionTitle,
} from "../../services/MetricsContext";
import { date } from "../../services/dates";

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

  const min = Math.min(...data.map((d) => d.d));
  const max = Math.max(...data.map((d) => d.d));

  return (
    <ResponsiveContainer height={220} width={"100%"}>
      <LineChart data={data}>
        <YAxis
          tickFormatter={(payload) => {
            if (payload === 0) return "";
            return formatConversionRate(type, payload);
          }}
          width={100}
          label={{
            value: getMetricConversionTitle(type),
            angle: -90,
            position: "insideBottomLeft",
            offset: 15,
          }}
        />
        <XAxis
          dataKey="d"
          type="number"
          height={50}
          domain={[min, max]}
          tickFormatter={(payload) => {
            return date(payload);
          }}
        />
        <Line
          strokeWidth={2}
          type="monotone"
          dataKey="v"
          stroke="#8884d8"
          dot={null}
        />
        <Tooltip
          formatter={(value) => {
            return [
              formatConversionRate(type, value as number),
              getMetricConversionTitle(type),
            ];
          }}
          labelFormatter={(label) => {
            return date(label as string);
          }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
};
export default DateGraph;
