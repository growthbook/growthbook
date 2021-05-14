import { FC } from "react";
import {
  AreaChart,
  XAxis,
  Area,
  //Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";

type ColorScheme = {
  left: {
    dark: string;
    light: string;
  };
  right: {
    dark: string;
    light: string;
  };
};

export const colorThemes: { [key: string]: ColorScheme } = {
  plusminus: {
    left: {
      dark: "#cf0404",
      light: "#ff8075",
    },
    right: {
      dark: "#30d395",
      light: "#a6edd1",
    },
  },
  neutral: {
    left: {
      dark: "#772eff",
      light: "#9c66ff",
    },
    right: {
      dark: "#039DD1",
      light: "#1dc4fc",
    },
  },
};

export interface Props {
  uid: string;
  ci: [number, number];
  domain: [number, number];
  buckets: { x: number; y: number }[];
  expected: number;
  width?: string | number;
  height?: string | number;
  inverse?: boolean;
  theme?: "plusminus" | "neutral";
}

const PercentImprovementGraph: FC<Props> = ({
  ci,
  buckets,
  domain,
  expected,
  uid,
  inverse,
  width = "100%",
  height = 250,
  theme = "plusminus",
}) => {
  const ticks = [];

  const colors = colorThemes[theme];

  // Not enough room to show confidence interval

  // Show full confidence interval

  ticks.push(ci[0]);
  ticks.push(expected);
  ticks.push(ci[1]);

  ticks.sort();

  // simple bin smoother:
  const maxx = Math.max(...buckets.map((b) => b.x));
  const minx = Math.min(...buckets.map((b) => b.x));
  const includesZero = minx < 0 && maxx > 0;
  const smoothAmount = 3;
  const smoothedData = [];
  let counter = 0;
  let avgy = [];
  let avgx = [];
  let zeroIndex = 0;

  // because we're loosing the first (and possbily last) data point,
  // we're going to manually add them back in:
  smoothedData.push({ x: buckets[0].x, y: buckets[0].y });
  buckets.map((b) => {
    avgx.push(b.x);
    avgy.push(b.y);
    counter++;

    if (counter === smoothAmount) {
      smoothedData.push({
        x: avgx.reduce((a, b) => a + b, 0) / avgx.length,
        y: avgy.reduce((a, b) => a + b, 0) / avgy.length,
      });
      //reset:
      counter = 0;
      avgx = [];
      avgy = [];
    }
  });
  if (avgy.length) {
    smoothedData.push({
      x: avgx.reduce((a, b) => a + b, 0) / avgx.length,
      y: avgy.reduce((a, b) => a + b, 0) / avgy.length,
    });
  }

  smoothedData.push({
    x: buckets[buckets.length - 1].x,
    y: buckets[buckets.length - 1].y,
  });

  // going to split the graph into two parts, positive and negative:
  smoothedData.map((b, i) => {
    if (includesZero && b.x < 0) zeroIndex = i;
    if (b.x < 0) {
      b.neg = b.y;
    }
    if (b.x >= 0) {
      b.pos = b.y;
    }
  });
  // since we have two parts, we want to make sure they are continious,
  // and we do that by adding a common 0 point for both graphs (linear aprox)
  if (includesZero) {
    // math:
    const yprime =
      ((smoothedData[zeroIndex + 1].y - smoothedData[zeroIndex].y) /
        (smoothedData[zeroIndex + 1].x - smoothedData[zeroIndex].x)) *
        (-1 * smoothedData[zeroIndex].x) +
      smoothedData[zeroIndex].y;
    smoothedData.splice(zeroIndex + 1, 0, {
      x: 0,
      y: yprime,
      pos: yprime,
      neg: yprime,
    });
  }

  return (
    <ResponsiveContainer height={height} width={width}>
      <AreaChart
        data={smoothedData}
        margin={{
          top: 0,
          right: 10,
          left: 10,
          bottom: 5,
        }}
      >
        <ReferenceLine x={0} stroke="grey" />
        <XAxis
          dataKey="x"
          ticks={ticks}
          domain={[1.3 * domain[0], 1.2 * domain[1]]}
          type="number"
          interval={0}
          tickFormatter={(payload) => {
            return parseFloat((payload * 100).toFixed(1)) + "%";
          }}
        />
        <defs>
          <linearGradient id={`positive_${uid}`} x1="0" y1="1" x2="0" y2="0">
            <stop
              offset="5%"
              stopColor={inverse ? colors.left.light : colors.right.light}
              stopOpacity={1}
            />
            <stop
              offset="95%"
              stopColor={inverse ? colors.left.dark : colors.right.dark}
              stopOpacity={1}
            />
          </linearGradient>
          <linearGradient id={`negative_${uid}`} x1="0" y1="1" x2="0" y2="0">
            <stop
              offset="5%"
              stopColor={inverse ? colors.right.light : colors.left.light}
              stopOpacity={1}
            />
            <stop
              offset="95%"
              stopColor={inverse ? colors.right.dark : colors.left.dark}
              stopOpacity={1}
            />
          </linearGradient>
        </defs>
        <Area
          strokeWidth={1}
          type="basis"
          dataKey="pos"
          fill={`url(#positive_${uid})`}
        />
        <Area
          strokeWidth={1}
          type="basis"
          dataKey="neg"
          fill={`url(#negative_${uid})`}
        />
        <Area strokeWidth={2} type="basis" dataKey="y" fill="none" />
        <ReferenceLine x={ci[0]} strokeDasharray="5 5" />
        <ReferenceLine x={ci[1]} strokeDasharray="5 5" />
        <ReferenceLine x={expected} strokeDasharray="5 5" />
      </AreaChart>
    </ResponsiveContainer>
  );
};

export default PercentImprovementGraph;
