import React from "react";
import { BarStackHorizontal } from "@visx/shape";
import { scaleBand, scaleLinear, scaleOrdinal } from "@visx/scale";
import { ParentSizeModern } from "@visx/responsive";
import { Group } from "@visx/group";
import { truncateString } from "shared/util";

const formatter = Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export default function BarChart100({
  data,
  max = 5,
}: {
  data: Record<string, number>;
  max?: number;
}) {
  const sortedData = Object.fromEntries(
    Object.entries(data).sort((a, b) => b[1] - a[1]),
  );

  const keys = Object.keys(sortedData).slice(0, max);

  const margin = [3, 3, 0, 3];

  const sum = Object.values(sortedData).reduce((acc, d) => acc + d, 0);

  const valueDomain = [0, sum];

  const height = 20;

  const purple1 = "#6c5efb";
  const purple2 = "#c998ff";
  const purple3 = "#a44afe";
  const colorScale = scaleOrdinal({
    domain: keys,
    range: [purple1, purple2, purple3],
  });

  const maxKeyLength = 20;

  return (
    <div>
      <ParentSizeModern style={{ position: "relative" }}>
        {({ width }) => {
          const yMax = height - margin[0] - margin[2];
          const xMax = width - margin[1] - margin[3];
          const graphHeight = yMax;

          const xScale = scaleLinear<number>({
            domain: valueDomain,
            range: [0, xMax],
            round: true,
          });
          const yScale = scaleBand<number>({
            domain: [0],
            range: [graphHeight, 0],
            round: true,
          });

          return (
            <svg width={width} height={height}>
              <Group left={margin[3]} top={margin[0]}>
                <BarStackHorizontal
                  data={[sortedData]}
                  keys={keys}
                  height={yMax}
                  width={width}
                  y={() => 0}
                  xScale={xScale}
                  yScale={yScale}
                  color={colorScale}
                >
                  {(barStacks) =>
                    barStacks.map((barStack) =>
                      barStack.bars.map((bar) => (
                        <rect
                          key={`barstack-horizontal-${barStack.index}-${bar.index}`}
                          x={bar.x}
                          y={bar.y}
                          width={bar.width}
                          height={bar.height}
                          fill={bar.color}
                        />
                      )),
                    )
                  }
                </BarStackHorizontal>
              </Group>
            </svg>
          );
        }}
      </ParentSizeModern>
      <div style={{ maxHeight: 200, overflowY: "auto" }}>
        <table className="w-100 gbtable table table-sm">
          <tbody>
            {keys.map((key) => (
              <tr key={key}>
                <td>
                  <div
                    style={{
                      width: 10,
                      height: 10,
                      background: colorScale(key),
                    }}
                  ></div>
                </td>
                <td title={key.length > maxKeyLength ? key : ""}>
                  {key ? truncateString(key, maxKeyLength) : <em>unknown</em>}
                </td>
                <td>{formatter.format(data[key])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
