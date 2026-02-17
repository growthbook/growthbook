import React, { DetailedHTMLProps, FC, HTMLAttributes } from "react";
import { GridColumns } from "@visx/grid";
import { Axis, Orientation, AxisLeft } from "@visx/axis";
import { scaleLinear } from "@visx/scale";
import { ParentSize } from "@visx/responsive";
import { Line } from "@visx/shape";
import { ViolinPlot } from "@visx/stats";
import normal from "@stdlib/stats/base/dists/normal";
import clsx from "clsx";
import { ExperimentMetricInterface } from "shared/experiments";
import { getExperimentMetricFormatter } from "@/services/metrics";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useCurrency } from "@/hooks/useCurrency";
import { SSRPolyfills } from "@/hooks/useSSRPolyfills";

interface Props
  extends DetailedHTMLProps<HTMLAttributes<SVGPathElement>, SVGPathElement> {
  id: string;
  ci?: [number, number];
  barType?: "pill" | "violin";
  barFillType?: "gradient" | "significant" | "color";
  barFillColor?: string;
  uplift?: { dist: string; mean?: number; stddev?: number };
  domain: [number, number];
  graphWidth?: number;
  height?: number;
  inverse?: boolean;
  expected?: number;
  significant: boolean;
  showAxis?: boolean;
  axisOnly?: boolean;
  zeroLineWidth?: number;
  zeroLineOffset?: number;
  metricForFormatting?: ExperimentMetricInterface | null;
  className?: string;
  rowStatus?: string;
  isHovered?: boolean;
  percent?: boolean;
  onMouseMove?: (e: React.MouseEvent<SVGPathElement>) => void;
  onMouseLeave?: (e: React.MouseEvent<SVGPathElement>) => void;
  onMouseEnter?: (e: React.MouseEvent<SVGPathElement>) => void;
  onClick?: (e: React.MouseEvent<SVGPathElement, MouseEvent>) => void;
  ssrPolyfills?: SSRPolyfills;
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
  barFillColor,
  uplift,
  domain,
  expected,
  significant = false,
  showAxis = false,
  axisOnly = false,
  zeroLineWidth = 1,
  zeroLineOffset = 0,
  metricForFormatting,
  graphWidth = 500,
  height = 30,
  inverse = false,
  className,
  rowStatus,
  isHovered = false,
  percent = true,
  onMouseMove,
  onMouseLeave,
  onMouseEnter,
  onClick,
  ssrPolyfills,
}) => {
  id = id.replaceAll("%20", "_").replace(/[\W]+/g, "_");
  const _metricDisplayCurrency = useCurrency();
  const { getFactTableById: _getFactTableById } = useDefinitions();

  const getFactTableById = ssrPolyfills?.getFactTableById || _getFactTableById;
  const metricDisplayCurrency =
    ssrPolyfills?.useCurrency() || _metricDisplayCurrency;

  const metricFormatterOptions = { currency: metricDisplayCurrency };

  const axisColor = "var(--color-text-mid)";
  const zeroLineColor = "var(--color-text-low)";
  const gridColor = "var(--slate-a3)";
  let barColor = "#aaa";
  let sigBarColorPos = "var(--jade-10)";
  let sigBarColorNeg = "var(--red-10)";
  let barColorOk = "#55ab95";
  let barColorWarning = "#d99132";
  let barColorDanger = "#d94032";
  const barThickness = 18;
  const barHeight = Math.floor(height / 2) - barThickness / 2;
  const violinOpacitySignificant = 0.9;
  const violinOpacityNotSignificant = 0.4;
  if (barFillType !== "color" && isHovered) {
    barColor = "#a0a0a0";
    sigBarColorPos = "var(--jade-11)";
    sigBarColorNeg = "var(--red-11)";
    barColorOk = "#4ec2a5";
    barColorWarning = "#ea9526";
    barColorDanger = "#e83223";
  }

  if (inverse && !rowStatus) {
    [sigBarColorNeg, sigBarColorPos] = [sigBarColorPos, sigBarColorNeg];
  }

  if (barType == "violin" && !uplift) {
    barType = "pill";
  }

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
    return metricForFormatting
      ? getExperimentMetricFormatter(metricForFormatting, getFactTableById)(
          v as number,
          metricFormatterOptions,
        )
      : !percent
        ? numberFormatter.format(v)
        : domainWidth < 0.05
          ? smallPercentFormatter.format(v)
          : percentFormatter.format(v);
  };

  // rough number of columns:
  const numTicks = Math.max(graphWidth / 75, 3);

  // todo: make ticks programmatic based roughly on the width

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
    barFillType === "color"
      ? barFillColor
      : barFillType === "gradient"
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
      barFill = barColor;
    } else if (rowStatus === "ok") {
      barFill = barColorOk;
    } else if (rowStatus === "warning") {
      barFill = barColorWarning;
    } else if (rowStatus === "danger") {
      barFill = barColorDanger;
    }
  }

  let barStyle = {};
  if (isHovered && barFillType === "color") {
    barStyle = { filter: "brightness(1.05) saturate(1.1)" };
  }

  const maskId = "mask_" + id;

  return (
    <div
      className={clsx(
        "d-flex aligned-graph align-items-center aligned-graph-row position-relative",
        className,
      )}
    >
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
          const tickLabelProps = (value) => {
            const currentX = xScale(value);
            const pos = currentX / graphWidth;
            if (pos < 0.06 || pos > 0.94) {
              return {
                display: "none",
              };
            }

            return {
              fill: axisColor,
              fontSize: 12,
              y: -10,
              x: currentX + 3,
              fontFamily: "sans-serif",
              textAnchor: "middle",
            } as const;
          };
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
                    left={xScale(0) - zeroLineWidth / 2 + zeroLineOffset}
                    scale={yScale}
                    tickFormat={tickFormat}
                    stroke={zeroLineColor}
                    strokeWidth={zeroLineWidth}
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
                  tickStroke={axisColor}
                  tickLabelProps={tickLabelProps}
                  tickClassName="ticktext"
                  numTicks={numTicks}
                  hideAxisLine={true}
                />
              )}
              {!axisOnly && (
                <>
                  {barType === "violin" && (
                    <ViolinPlot
                      onMouseMove={onMouseMove}
                      onMouseLeave={onMouseLeave}
                      onMouseEnter={onMouseEnter}
                      onClick={onClick}
                      className={clsx("hover-target aligned-graph-violin", {
                        hover: isHovered,
                      })}
                      style={{ transition: "100ms all", ...barStyle }}
                      top={barHeight}
                      width={barThickness}
                      left={xScale(ci?.[0] ?? 0)}
                      data={[
                        0.025, 0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8,
                        0.9, 0.95, 0.975,
                      ].map((n) => {
                        let x = normal.quantile(
                          n,
                          uplift?.mean || 0,
                          uplift?.stddev || 0,
                        );
                        const y = normal.pdf(
                          x,
                          uplift?.mean || 0,
                          uplift?.stddev || 0,
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
                      onMouseEnter={onMouseEnter}
                      onClick={onClick}
                      className={clsx("hover-target aligned-graph-pill", {
                        hover: isHovered,
                      })}
                      style={{ transition: "100ms all", ...barStyle }}
                      x={xScale(Math.max(ci?.[0] ?? 0, domain[0] - 0.1))}
                      y={barHeight}
                      width={
                        xScale(Math.min(ci?.[1] ?? 0, domain[1] + 0.1)) -
                        xScale(Math.max(ci?.[0] ?? 0, domain[0] - 0.1))
                      }
                      height={barThickness}
                      fill={barFill}
                      fillOpacity={0.8}
                      rx={10}
                      mask={`url(#${maskId})`}
                    />
                  )}
                  <Line
                    fill={"var(--slate-a9)"}
                    strokeWidth={1}
                    stroke={"var(--slate-a9)"}
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
  );
};

export default AlignedGraph;
