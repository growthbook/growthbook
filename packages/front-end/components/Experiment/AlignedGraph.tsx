import React, { DetailedHTMLProps, FC, HTMLAttributes } from "react";
import { GridColumns } from "@visx/grid";
import { Axis, Orientation, AxisLeft } from "@visx/axis";
import { scaleLinear } from "@visx/scale";
import ParentSize from "@visx/responsive/lib/components/ParentSize";
import { Line } from "@visx/shape";
import { FaArrowUp, FaArrowDown } from "react-icons/fa";
import { ViolinPlot } from "@visx/stats";
import normal from "@stdlib/stats/base/dists/normal";
import clsx from "clsx";

interface Props
  extends DetailedHTMLProps<HTMLAttributes<SVGPathElement>, SVGPathElement> {
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
  zeroLineWidth?: number;
  barColor?: string;
  sigBarColorPos?: string;
  sigBarColorNeg?: string;
  // barColorDraw?: string;
  barColorOk?: string;
  barColorWarning?: string;
  barColorDanger?: string;
  expectedColor?: string;
  newUi?: boolean;
  className?: string;
  rowStatus?: string;
  isHovered?: boolean;
  percent?: boolean;
  onMouseMove?: (e: React.MouseEvent<SVGPathElement>) => void;
  onMouseLeave?: (e: React.MouseEvent<SVGPathElement>) => void;
  onClick?: (e: React.MouseEvent<SVGPathElement, MouseEvent>) => void;
}

const smallPercentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 1,
});

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 0,
});

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
  gridColor = "#5c9ea94c",
  axisColor = "var(--text-link-hover-color)",
  zeroLineColor = "#0077b6",
  zeroLineWidth = 1,
  barColor = "#aaaaaaaa",
  sigBarColorPos = "#0D8C8Ccc",
  sigBarColorNeg = "#D94032cc",
  // barColorDraw = "#9C89BEcc",
  barColorOk = "#55ab95cc",
  barColorWarning = "#d99132cc",
  barColorDanger = "#d94032cc",
  newUi = false,
  className,
  rowStatus,
  isHovered = false,
  percent = true,
  onMouseMove,
  onMouseLeave,
  onClick,
}) => {
  const violinOpacitySignificant = 0.8;
  let violinOpacityNotSignificant = 0.8;
  if (newUi) {
    zeroLineWidth = 3;
    gridColor = "#0077b633";
    barColor = "#aaa";
    sigBarColorPos = "#52be5b";
    sigBarColorNeg = "#d35a5a";
    // barColorDraw = "#9C89BE";
    barColorOk = "#55ab95";
    barColorWarning = "#d99132";
    barColorDanger = "#d94032";
    if (isHovered) {
      barColor = "#a0a0a0";
      sigBarColorPos = "#39cb45";
      sigBarColorNeg = "#e34040";
      // barColorDraw = "#957dc2";
      barColorOk = "#4ec2a5";
      barColorWarning = "#ea9526";
      barColorDanger = "#e83223";
    }
    violinOpacityNotSignificant = 0.4;
  }

  if (barType == "violin" && !uplift) {
    barType = "pill";
  }

  const barThickness = newUi ? 20 : 16;

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

  const domainWidth = rightDomain - leftDomain;

  const numberFormatter = Intl.NumberFormat(undefined, {
    ...(domainWidth > 5000 ? { notation: "compact" } : {}),
  });
  const tickFormat = (v: number) => {
    return !percent
      ? numberFormatter.format(v)
      : domainWidth < 0.05
      ? smallPercentFormatter.format(v)
      : percentFormatter.format(v);
  };

  const barHeight = Math.floor(height / 2) - barThickness / 2;

  if (inverse && !rowStatus) {
    [sigBarColorNeg, sigBarColorPos] = [sigBarColorPos, sigBarColorNeg];
  }
  // rough number of columns:
  let numTicks = 6;
  if (newUi) {
    numTicks = Math.max(graphWidth / 75, 3);
  }
  // todo: make ticks programic based roughtly on the width
  // todo: make the significant threashold centralized, and adjustable.

  const gradient: { color: string; percent: number }[] = [];
  const gradientId = "gr_" + id;
  if (ci && barFillType === "gradient") {
    if ((ci?.[0] ?? 0) < 0) {
      gradient.push({ color: sigBarColorNeg, percent: 0 });
      if ((ci?.[1] ?? 0) > 0) {
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

  let barFill =
    barFillType === "gradient"
      ? `url(#${gradientId})`
      : significant
      ? (expected ?? 0) > 0
        ? sigBarColorPos
        : sigBarColorNeg
      : barColor;

  // forced color state (nothing needed for non-significant):
  if (barFillType === "significant") {
    if (rowStatus === "won") {
      barFill = sigBarColorPos;
    } else if (rowStatus === "lost") {
      barFill = sigBarColorNeg;
    } else if (rowStatus === "draw") {
      // barFill = barColorDraw;
      barFill = barColor;
    } else if (rowStatus === "ok") {
      barFill = barColorOk;
    } else if (rowStatus === "warning") {
      barFill = barColorWarning;
    } else if (rowStatus === "danger") {
      barFill = barColorDanger;
    }
  }

  const maskId = "mask_" + id;

  return (
    <>
      <div
        className={clsx(
          "d-flex aligned-graph align-items-center aligned-graph-row",
          className
        )}
      >
        <div className={newUi ? "" : "flex-grow-1"}>
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
                  <svg width={graphWidth} height={height} className="d-block">
                    <defs>
                      {gradient.length > 0 && (
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
                      )}
                      <mask id={maskId}>
                        <linearGradient
                          id={maskId + "_grad"}
                          x1="0%"
                          y1="0%"
                          x2="100%"
                          y2="0%"
                        >
                          {(ci?.[0] ?? 0) < domain[0] && (
                            <stop offset="0%" stopColor="#222" />
                          )}
                          <stop offset="5%" stopColor="#fff" />
                          <stop offset="95%" stopColor="#fff" />
                          {(ci?.[1] ?? 0) > domain[1] && (
                            <stop offset="100%" stopColor="#222" />
                          )}
                        </linearGradient>
                        <rect
                          x={0}
                          y={0}
                          width={graphWidth}
                          height={height}
                          fill={`url(#${maskId}_grad)`}
                        />
                      </mask>
                    </defs>
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
                          left={xScale(0) - Math.floor(zeroLineWidth / 2)}
                          scale={yScale}
                          tickFormat={tickFormat}
                          stroke={zeroLineColor}
                          strokeWidth={zeroLineWidth}
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
                        stroke={newUi ? "" : axisColor}
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
                            onMouseMove={onMouseMove}
                            onMouseLeave={onMouseLeave}
                            onClick={onClick}
                            className={clsx(
                              "hover-target aligned-graph-violin",
                              {
                                hover: isHovered,
                              }
                            )}
                            style={{ transition: "100ms all" }}
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
                              let x = normal.quantile(
                                n,
                                uplift?.mean || 0,
                                uplift?.stddev || 0
                              );
                              const y = normal.pdf(
                                x,
                                uplift?.mean || 0,
                                uplift?.stddev || 0
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
                            fillOpacity={
                              significant
                                ? violinOpacitySignificant
                                : violinOpacityNotSignificant
                            }
                            mask={`url(#${maskId})`}
                          />
                        )}
                        {barType === "pill" && (
                          <rect
                            onMouseMove={onMouseMove}
                            onMouseLeave={onMouseLeave}
                            onClick={onClick}
                            className={clsx("hover-target aligned-graph-pill", {
                              hover: isHovered,
                            })}
                            style={{ transition: "100ms all" }}
                            x={xScale(Math.max(ci?.[0] ?? 0, domain[0] - 0.1))}
                            y={barHeight}
                            width={
                              xScale(Math.min(ci?.[1] ?? 0, domain[1] + 0.1)) -
                              xScale(Math.max(ci?.[0] ?? 0, domain[0] - 0.1))
                            }
                            height={barThickness}
                            fill={barFill}
                            fillOpacity={0.8}
                            rx={newUi ? 10 : 8}
                            mask={`url(#${maskId})`}
                          />
                        )}
                        <Line
                          fill="#000000"
                          strokeWidth={3}
                          stroke={"#0008"}
                          from={{ x: xScale(expected ?? 0), y: barHeight }}
                          to={{
                            x: xScale(expected ?? 0),
                            y: barHeight + barThickness,
                          }}
                          style={{ pointerEvents: "none" }}
                        />
                      </>
                    )}
                  </svg>
                );
              }}
            </ParentSize>
          </div>
        </div>
        {!axisOnly && !newUi && (
          <>
            <div className="expectedwrap text-right">
              <span className="expectedArrows">
                {(expected ?? 0) > 0 ? <FaArrowUp /> : <FaArrowDown />}
              </span>{" "}
              <span className="expected bold">
                {parseFloat(
                  ((expected ?? 0) * (percent ? 100 : 1)).toFixed(1)
                ) + (percent ? "%" : "")}{" "}
              </span>
            </div>
          </>
        )}
      </div>
    </>
  );
};

export default AlignedGraph;
