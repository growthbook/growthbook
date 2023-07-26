import React, { FC } from "react";
import { GridColumns } from "@visx/grid";
import { Axis, Orientation, AxisLeft } from "@visx/axis";
import { scaleLinear } from "@visx/scale";
import ParentSize from "@visx/responsive/lib/components/ParentSize";
import { Line } from "@visx/shape";
import { FaArrowUp, FaArrowDown } from "react-icons/fa";
import { ViolinPlot } from "@visx/stats";
import { jStat } from "jstat";

export interface Props {
  id: string;
  ci?: [number, number] | [];
  barType?: "pill" | "violin";
  barFillType?: "gradient" | "significant";
  uplift?: { dist: string; mean?: number; stddev?: number };
  domain: [number, number];
  //width: string | number;
  height?: number;
  inverse?: boolean;
  graphWidth?: number;
  expected?: number;
  significant: boolean;
  showAxis?: boolean;
  axisOnly?: boolean;
  gridColor?: string;
  axisColor?: string;
  zeroLineColor?: string;
  barColor?: string;
  sigBarColorPos?: string;
  sigBarColorNeg?: string;
  expectedColor?: string;
  newUi?: boolean;
}

const AlignedGraph: FC<Props> = ({
  id,
  ci,
  barType = "pill",
  barFillType = "gradient",
  uplift,
  domain,
  expected,
  significant = false,
  showAxis = false,
  axisOnly = false,
  //width = "100%",
  height = 30,
  inverse = false,
  graphWidth = 500,
  gridColor = "#90e0efaa",
  axisColor = "var(--text-link-hover-color)",
  zeroLineColor = "#0077b6",
  barColor = "#aaaaaaaa",
  sigBarColorPos = "#0D8C8Ccc",
  sigBarColorNeg = "#D94032cc",
  newUi = false,
}) => {
  if (newUi) {
    sigBarColorPos = "#52be5b";
    sigBarColorNeg = "#be9c96";
  }

  if (barType == "violin" && !uplift) {
    barType = "pill";
  }

  const barThickness = 16;

  const tickLabelColor = axisColor;
  const tickLabelProps = () =>
    ({
      fill: tickLabelColor,
      fontSize: 12,
      y: -10,
      fontFamily: "sans-serif",
      textAnchor: "middle",
    } as const);

  // add some spacing around the graph
  const domainPadding = (domain[1] - domain[0]) * 0.1;
  const leftDomain = domain[0] - domainPadding;
  const rightDomain = domain[1] + domainPadding;
  domain = [leftDomain, rightDomain];
  const tickFormat = (v: number) => {
    return " " + Math.round(v * 100) + "%";
  };

  const barHeight = Math.floor(height / 2) - barThickness / 2;

  if (inverse) {
    [sigBarColorNeg, sigBarColorPos] = [sigBarColorPos, sigBarColorNeg];
  }
  // rough number of columns:
  const numTicks = 6;
  // todo: make ticks programic based roughtly on the width
  // todo: make the significant threashold centralized, and adjustable.

  const gradient: { color: string; percent: number }[] = [];
  const gradientId = "gr_" + id;
  if (ci && barFillType === "gradient") {
    if (ci?.[0] ?? 0 < 0) {
      gradient.push({ color: sigBarColorNeg, percent: 0 });
      if (ci?.[1] ?? 0 > 0) {
        const w = (ci?.[1] ?? 0) - (ci?.[0] ?? 0);
        const wNeg = (100 * (-1 * (ci?.[0] ?? 0))) / w;
        gradient.push({ color: sigBarColorNeg, percent: wNeg });
        gradient.push({ color: sigBarColorPos, percent: wNeg + 0.001 });
        gradient.push({ color: sigBarColorPos, percent: 100 });
      } else {
        gradient.push({ color: sigBarColorNeg, percent: 100 });
      }
    } else {
      gradient.push({ color: sigBarColorPos, percent: 0 });
      gradient.push({ color: sigBarColorPos, percent: 100 });
    }
  }

  const barFill =
    barFillType === "gradient"
      ? `url(#${gradientId})`
      : significant
      ? (expected ?? 0) > 0
        ? sigBarColorPos
        : sigBarColorNeg
      : barColor;

  return (
    <>
      <div className="d-flex aligned-graph align-items-center aligned-graph-row">
        <div className="flex-grow-1">
          <div style={{ position: "relative" }}>
            <ParentSize className="graph-container" debounceTime={1000}>
              {({ height: visHeight }) => {
                const yScale = scaleLinear({
                  domain: [0, 100],
                  range: [0, visHeight],
                });
                const xScale = scaleLinear({
                  domain: domain,
                  range: [0, graphWidth],
                });
                return (
                  <svg width={graphWidth} height={height}>
                    {gradient.length > 0 && (
                      <defs>
                        <linearGradient
                          id={gradientId}
                          x1="0%"
                          y1="0%"
                          x2="100%"
                          y2="0%"
                        >
                          {gradient.map((g) => (
                            <stop
                              key={g.percent}
                              offset={g.percent + "%"}
                              stopColor={g.color}
                            />
                          ))}
                        </linearGradient>
                      </defs>
                    )}
                    {!showAxis && (
                      <>
                        <GridColumns
                          scale={xScale}
                          width={graphWidth}
                          height={visHeight}
                          stroke={gridColor}
                          numTicks={numTicks}
                        />

                        <AxisLeft
                          key={`test`}
                          orientation={Orientation.left}
                          left={xScale(0)}
                          scale={yScale}
                          tickFormat={tickFormat}
                          stroke={zeroLineColor}
                          /*tickValues={[-100, -20, -15, -10, -5, 0, 5, 10, 15, 20]}*/
                          numTicks={0}
                        />
                      </>
                    )}
                    {showAxis && (
                      <Axis
                        key={`test`}
                        orientation={Orientation.top}
                        top={visHeight}
                        scale={xScale}
                        tickLength={5}
                        tickFormat={tickFormat}
                        stroke={axisColor}
                        tickStroke={axisColor}
                        tickLabelProps={tickLabelProps}
                        tickClassName="ticktext"
                        numTicks={numTicks}
                      />
                    )}
                    {!axisOnly && (
                      <>
                        {barType === "violin" && (
                          <ViolinPlot
                            top={barHeight}
                            width={barThickness}
                            left={xScale(ci?.[0] ?? 0)}
                            data={[
                              0.025,
                              0.05,
                              0.1,
                              0.2,
                              0.3,
                              0.4,
                              0.5,
                              0.6,
                              0.7,
                              0.8,
                              0.9,
                              0.95,
                              0.975,
                            ].map((n) => {
                              let x = jStat.normal.inv(
                                n,
                                uplift?.mean,
                                uplift?.stddev
                              );
                              const y = jStat.normal.pdf(
                                x,
                                uplift?.mean,
                                uplift?.stddev
                              );

                              if (uplift?.dist === "lognormal") {
                                x = Math.exp(x) - 1;
                              }

                              return {
                                x,
                                y,
                              };
                            })}
                            valueScale={xScale}
                            count={(d) => d.y}
                            value={(d) => d.x}
                            horizontal={true}
                            fill={barFill}
                            fillOpacity={0.8}
                          />
                        )}
                        {barType === "pill" && (
                          <rect
                            x={xScale(ci?.[0] ?? 0)}
                            y={barHeight}
                            width={xScale(ci?.[1] ?? 0) - xScale(ci?.[0] ?? 0)}
                            height={barThickness}
                            fill={barFill}
                            rx={8}
                          />
                        )}
                        <Line
                          fill="#000000"
                          strokeWidth={3}
                          stroke={"#666"}
                          from={{ x: xScale(expected ?? 0), y: barHeight }}
                          to={{
                            x: xScale(expected ?? 0),
                            y: barHeight + barThickness,
                          }}
                        />
                      </>
                    )}
                  </svg>
                );
              }}
            </ParentSize>
          </div>
        </div>
        {!axisOnly && (
          <>
            <div className="expectedwrap text-right">
              <span className="expectedArrows">
                {(expected ?? 0) > 0 ? <FaArrowUp /> : <FaArrowDown />}
              </span>{" "}
              <span className="expected bold">
                {parseFloat(((expected ?? 0) * 100).toFixed(1)) + "%"}{" "}
              </span>
            </div>
          </>
        )}
      </div>
    </>
  );
};

export default AlignedGraph;
