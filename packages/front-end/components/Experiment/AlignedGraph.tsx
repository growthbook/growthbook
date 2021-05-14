import React, { FC, useState } from "react";
import { GridColumns } from "@visx/grid";
import { Axis, Orientation, AxisLeft } from "@visx/axis";
import { scaleLinear } from "@visx/scale";
import ParentSize from "@visx/responsive/lib/components/ParentSize";
import { Tooltip } from "@visx/tooltip";
import { Line } from "@visx/shape";
import { FaArrowUp, FaArrowDown } from "react-icons/fa";
import PercentImprovementGraph from "./PercentImprovementGraph";
import { SnapshotMetric } from "back-end/types/experiment-snapshot";
import Portal from "./Portal";

export interface Props {
  ci?: [number, number] | [];
  domain: [number, number];
  //width: string | number;
  height: number;
  stats?: SnapshotMetric;
  metricName?: string;
  graphWidth?: number;
  expected?: number;
  inverse?: boolean;
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
}

const AlignedGraph: FC<Props> = ({
  ci,
  domain,
  expected,
  significant = false,
  showAxis = false,
  axisOnly = false,
  //width = "100%",
  height = 30,
  inverse = false,
  stats = {},
  metricName = "",
  graphWidth = 500,
  gridColor = "#90e0efaa",
  axisColor = "#023e8a",
  zeroLineColor = "#0077b6",
  barColor = "#aaaaaaaa",
  sigBarColorPos = "#0D8C8Ccc",
  sigBarColorNeg = "#D94032cc",
  expectedColor = "#fb8500",
}) => {
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const [tooltipOffset, setTooltipOffset] = useState<[number, number]>([0, 0]);

  const barThickness = 16;
  const tooltipWidth = 250;

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
  const leftDomain =
    Math.abs(domain[0]) > 0.02 ? domain[0] * 1.2 : domain[0] - 0.02;
  const rightDomain =
    Math.abs(domain[1]) > 0.02 ? domain[1] * 1.2 : domain[1] + 0.02;
  domain = [leftDomain, rightDomain];
  const tickFormat = (v: number) => {
    return " " + Math.round(v * 100) + "%";
  };

  const barHeight = Math.floor(height / 2) - barThickness / 2;

  // rough number of columns:
  const numTicks = 6;
  // todo: make ticks programic based roughtly on the width
  // todo: make the significant threashold centralized, and adjustable.

  return (
    <>
      <div className="d-flex aligned-graph align-items-center">
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
                  <svg
                    width={graphWidth}
                    height={height}
                    onMouseLeave={() => {
                      setTooltipOpen(false);
                    }}
                    onMouseEnter={(e) => {
                      const boundingBox = (e.target as HTMLElement).getBoundingClientRect();
                      const scrollOffsetParent = (e.target as HTMLElement).closest(
                        ".experiment-compact-holder"
                      ) as HTMLElement;
                      const minX =
                        scrollOffsetParent?.getBoundingClientRect()?.x || 0;
                      setTooltipOffset([
                        Math.max(boundingBox.x, minX + 80),
                        boundingBox.y,
                      ]);
                    }}
                    onMouseMove={() => {
                      setTooltipOpen(true);
                    }}
                  >
                    {!showAxis && (
                      <>
                        <GridColumns
                          scale={xScale}
                          width={graphWidth}
                          height={visHeight}
                          stroke={gridColor}
                          numTicks={numTicks}
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
                        <rect
                          x={xScale(ci[0])}
                          y={barHeight}
                          width={xScale(ci[1]) - xScale(ci[0])}
                          height={barThickness}
                          fill={
                            significant
                              ? expected > 0
                                ? sigBarColorPos
                                : sigBarColorNeg
                              : barColor
                          }
                          rx={8}
                        />
                        <Line
                          fill="#000000"
                          strokeWidth={3}
                          stroke={expectedColor}
                          from={{ x: xScale(expected), y: barHeight }}
                          to={{
                            x: xScale(expected),
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
                {expected > 0 ? <FaArrowUp /> : <FaArrowDown />}
              </span>{" "}
              <span className="expected bold">
                {parseFloat((expected * 100).toFixed(1)) + "%"}{" "}
              </span>
              <span className="errorrange">
                &plusmn; {parseFloat(((ci[1] - expected) * 100).toFixed(1))}%
              </span>
            </div>
            {tooltipOpen && (
              <Portal>
                <Tooltip
                  top={-1 * height + tooltipOffset[1]}
                  left={-1 * tooltipWidth - 10 + tooltipOffset[0]}
                  style={{
                    position: "absolute",
                    backgroundColor: "white",
                    color: "rgb(102, 102, 102)",
                    padding: "0.5rem 0.5rem",
                    borderRadius: "8px",
                    fontSize: "14px",
                    boxShadow: "rgb(33 33 33 / 45%) 0px 1px 2px",
                    lineHeight: "1em",
                    pointerEvents: "none",
                    opacity: 1,
                    zIndex: 1000,
                  }}
                  className="experiment-tooltip"
                >
                  <div className="tooltip-arrow"></div>
                  <div style={{ width: tooltipWidth }}>
                    <p className="text-center">{metricName} change</p>
                    <PercentImprovementGraph
                      uid={"" + Math.floor(Math.random() * 10000)}
                      buckets={stats.buckets}
                      expected={stats.expected}
                      ci={stats.ci}
                      height={100}
                      inverse={inverse}
                      domain={[ci[0], ci[1]]}
                    />
                    <div className="tooltip-results">
                      {!significant && (
                        <p className="text-muted">(not significant)</p>
                      )}
                      <div className="d-flex justify-content-center mb-1">
                        <div className="px-1 result-text text-right">
                          Worst case:
                        </div>
                        <div
                          className={`px-1 tooltip-ci ci-worst ${
                            ci[0] < 0 ? "ci-neg" : "ci-pos"
                          }`}
                        >
                          {ci[0] > 0 && "+"}
                          {parseFloat((ci[0] * 100).toFixed(2))}%
                        </div>
                      </div>
                      <div className="d-flex justify-content-center mb-1">
                        <div className="px-1 result-text text-right">
                          Most likely:
                        </div>
                        <div
                          className={`px-1 tooltip-ci ci-likely ${
                            expected < 0 ? "ci-neg" : "ci-pos"
                          }`}
                        >
                          {expected > 0 && "+"}
                          {parseFloat((expected * 100).toFixed(2))}%
                        </div>
                      </div>
                      <div className="d-flex justify-content-center mb-1">
                        <div className="px-1 result-text text-right">
                          Best case:
                        </div>
                        <div
                          className={`px-1 tooltip-ci ci-best ${
                            ci[1] < 0 ? "ci-neg" : "ci-pos"
                          }`}
                        >
                          {ci[1] > 0 && "+"}
                          {parseFloat((ci[1] * 100).toFixed(2))}%
                        </div>
                      </div>
                    </div>
                  </div>
                </Tooltip>
              </Portal>
            )}
          </>
        )}
      </div>
    </>
  );
};

export default AlignedGraph;
