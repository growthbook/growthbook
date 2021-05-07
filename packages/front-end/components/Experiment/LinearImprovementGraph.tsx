import { FC } from "react";
import {
  LineChart,
  XAxis,
  YAxis,
  Line,
  //Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";

export interface Props {
  ci: [number, number] | [];
  domain: [number, number];
  width: string | number;
  height: string | number;
  expected: number;
  negColor?: string;
  posColor?: string;
}

const LinearImprovementGraph: FC<Props> = ({
  ci,
  domain,
  expected,
  width = "100%",
  height = 60,
  negColor = "#d33e31",
  posColor = "#30d395",
}) => {
  const ticks = [];

  // Show full confidence interval

  ticks.push(ci[0]);
  ticks.push(expected);
  ticks.push(ci[1]);

  ticks.sort();

  const yVal = 10;
  const lineWidth = 20;

  const data = [];

  if (ci[0] < 0) {
    data.push({ x: ci[0], y: yVal, neg: yVal });
  } else {
    data.push({ x: ci[0], y: yVal, pos: yVal });
  }
  if (ci[0] < 0 && ci[1] > 0) {
    // passes through 0, so add that point:
    data.push({ x: 0, y: yVal, pos: yVal, neg: yVal });
  }
  if (ci[1] < 0) {
    data.push({ x: ci[1], y: yVal, neg: yVal });
  } else {
    data.push({ x: ci[1], y: yVal, pos: yVal });
  }

  return (
    <ResponsiveContainer height={height} width={width}>
      <LineChart data={data}>
        <ReferenceLine x={0} stroke="grey" />
        <YAxis
          type="number"
          domain={[0, lineWidth]}
          axisLine={false}
          hide={true}
        />
        <XAxis
          dataKey="x"
          ticks={ticks}
          domain={[1.1 * domain[0], 1.1 * domain[1]]}
          type="number"
          stroke={"black"}
          axisLine={false}
          interval={0}
          tickFormatter={(payload) => {
            return parseFloat((payload * 100).toFixed(1)) + "%";
          }}
        />
        <Line
          type="linear"
          stroke={posColor}
          dataKey="pos"
          strokeWidth={lineWidth}
          dot={false}
        />
        <Line
          type="linear"
          stroke={negColor}
          dataKey="neg"
          strokeWidth={lineWidth}
          dot={false}
        />
        <ReferenceLine x={ci[0]} strokeDasharray="5 5" />
        <ReferenceLine x={ci[1]} strokeDasharray="5 5" />
        <ReferenceLine
          x={expected}
          strokeDasharray="3 2"
          stroke="black"
          strokeWidth="2"
        />
      </LineChart>
    </ResponsiveContainer>
  );
};

export default LinearImprovementGraph;
