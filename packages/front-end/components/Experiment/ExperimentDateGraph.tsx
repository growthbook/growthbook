import styles from "./ExperimentDateGraph.module.scss";
import { FC, Fragment } from "react";
import { date } from "../../services/dates";
import { ParentSizeModern } from "@visx/responsive";
import { Group } from "@visx/group";
import { GridColumns, GridRows } from "@visx/grid";
import { scaleLinear, scaleTime } from "@visx/scale";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { AreaClosed, LinePath } from "@visx/shape";
import { curveMonotoneX } from "@visx/curve";
import {
  TooltipWithBounds,
  useTooltip,
  useTooltipInPortal,
} from "@visx/tooltip";
export interface ExperimentDateGraphDataPoint {
  d: Date;
  variations: {
    label: string;
    value: number;
    stddev?: number;
  }[];
}
export interface ExperimentDateGraphProps {
  variationNames: string[];
  label: string;
  datapoints: ExperimentDateGraphDataPoint[];
  tickFormat: (v: number) => string;
}

const COLORS = ["#772eff", "#039dd1", "#fd7e14", "#e83e8c"];

type TooltipData = { x: number; y: number[]; d: ExperimentDateGraphDataPoint };

function addStddev(
  value?: number,
  stddev?: number,
  num: number = 1,
  add: boolean = true
) {
  value = value ?? 0;
  stddev = stddev ?? 0;
  const err = stddev * num;
  return add ? value + err : value - err;
}

const ExperimentDateGraph: FC<ExperimentDateGraphProps> = ({
  datapoints,
  variationNames,
  label,
  tickFormat,
}) => {
  const getTooltipData = (mx: number, width: number, yScale): TooltipData => {
    const innerWidth =
      width - margin[1] - margin[3] + width / datapoints.length - 1;
    const px = mx / innerWidth;
    const index = Math.max(
      Math.min(Math.round(px * datapoints.length), datapoints.length - 1),
      0
    );
    const d = datapoints[index];
    const x =
      (datapoints.length > 0 ? index / datapoints.length : 0) * innerWidth;
    const y = d.variations.map((v) => yScale(v.value) ?? 0);
    return { x, y, d };
  };

  const getTooltipContents = (d: ExperimentDateGraphDataPoint) => {
    return (
      <>
        {variationNames.map((v, i) => {
          return (
            <div key={i} style={{ color: COLORS[i % COLORS.length] }}>
              {v}: <span className={styles.val}>{d.variations[i]?.label}</span>
            </div>
          );
        })}
        <div className={styles.date}>{date(d.d as Date)}</div>
      </>
    );
  };

  const { containerRef, containerBounds } = useTooltipInPortal({
    scroll: true,
    detectBounds: true,
  });

  const {
    showTooltip,
    hideTooltip,
    tooltipOpen,
    tooltipData,
    tooltipLeft = 0,
    tooltipTop = 0,
  } = useTooltip<TooltipData>();

  const height = 220;
  const margin = [15, 15, 30, 80];
  const min = Math.min(...datapoints.map((d) => d.d.getTime()));
  const max = Math.max(...datapoints.map((d) => d.d.getTime()));

  return (
    <ParentSizeModern>
      {({ width }) => {
        const yMax = height - margin[0] - margin[2];
        const xMax = width - margin[1] - margin[3];
        const numXTicks = width > 768 ? 7 : 4;
        const numYTicks = 5;

        const xScale = scaleTime({
          domain: [min, max],
          range: [0, xMax],
          round: true,
        });
        const yScale = scaleLinear<number>({
          domain: [
            Math.min(
              ...datapoints.map((d) =>
                Math.min(
                  ...d.variations.map((v) => v.value - (v.stddev ?? 0) * 2)
                )
              )
            ),
            Math.max(
              ...datapoints.map((d) =>
                Math.max(
                  ...d.variations.map((v) => v.value + (v.stddev ?? 0) * 2)
                )
              )
            ),
          ],
          range: [yMax, 0],
          round: true,
        });

        const handlePointer = (event: React.PointerEvent<HTMLDivElement>) => {
          // coordinates should be relative to the container in which Tooltip is rendered
          const containerX =
            ("clientX" in event ? event.clientX : 0) - containerBounds.left;
          const data = getTooltipData(containerX, width, yScale);
          showTooltip({
            tooltipLeft: data.x,
            tooltipTop: Math.min(...data.y),
            tooltipData: data,
          });
        };

        return (
          <>
            <div className="d-flex">
              {variationNames.map((v, i) => {
                return (
                  <div
                    key={i}
                    className="mx-2"
                    style={{ color: COLORS[i % COLORS.length] }}
                  >
                    <strong>&mdash;</strong> {v}
                  </div>
                );
              })}
            </div>
            <div
              ref={containerRef}
              className={styles.tooltipDategraph}
              style={{
                width: width - margin[1] - margin[3],
                height: height - margin[0] - margin[2],
                marginLeft: margin[3],
                marginTop: margin[0],
              }}
              onPointerMove={handlePointer}
              onPointerLeave={hideTooltip}
            >
              {tooltipOpen && (
                <>
                  {variationNames.map((v, i) => {
                    return (
                      <div
                        key={i}
                        className={styles.positionIndicator}
                        style={{
                          transform: `translate(${tooltipLeft}px, ${tooltipData.y[i]}px)`,
                          background: COLORS[i % COLORS.length],
                        }}
                      />
                    );
                  })}
                  <div
                    className={styles.crosshair}
                    style={{ transform: `translateX(${tooltipLeft}px)` }}
                  />
                  <TooltipWithBounds
                    left={tooltipLeft}
                    top={tooltipTop}
                    className={styles.tooltip}
                    unstyled={true}
                  >
                    {getTooltipContents(tooltipData.d)}
                  </TooltipWithBounds>
                </>
              )}
            </div>
            <svg width={width} height={height}>
              <Group left={margin[3]} top={margin[0]}>
                <GridRows scale={yScale} width={xMax} numTicks={numYTicks} />
                <GridColumns
                  scale={xScale}
                  height={yMax}
                  numTicks={numXTicks}
                />

                {variationNames.map((v, i) => {
                  return typeof datapoints[0]?.variations?.[i]?.stddev !==
                    "undefined" ? (
                    <AreaClosed
                      key={i}
                      yScale={yScale}
                      data={datapoints}
                      x={(d) => xScale(d.d) ?? 0}
                      y0={(d) =>
                        yScale(
                          addStddev(
                            d.variations[i]?.value || 0,
                            d.variations[i]?.stddev || 0,
                            2,
                            false
                          )
                        )
                      }
                      y1={(d) =>
                        yScale(
                          addStddev(
                            d.variations[i]?.value,
                            d.variations[i]?.stddev || 0,
                            2,
                            true
                          )
                        )
                      }
                      fill={COLORS[i % COLORS.length]}
                      opacity={0.12}
                      curve={curveMonotoneX}
                    />
                  ) : (
                    ""
                  );
                })}

                {variationNames.map((v, i) => {
                  return (
                    <LinePath
                      key={i}
                      data={datapoints}
                      x={(d) => xScale(d.d) ?? 0}
                      y={(d) => yScale(d.variations[i]?.value) ?? 0}
                      stroke={COLORS[i % COLORS.length]}
                      strokeWidth={2}
                      curve={curveMonotoneX}
                    />
                  );
                })}

                <AxisBottom
                  top={yMax}
                  scale={xScale}
                  numTicks={numXTicks}
                  tickFormat={(d) => {
                    return date(d as Date);
                  }}
                />
                <AxisLeft
                  scale={yScale}
                  numTicks={numYTicks}
                  tickFormat={(v) => tickFormat(v as number)}
                  label={label}
                  labelClassName="h5"
                />
              </Group>
            </svg>
          </>
        );
      }}
    </ParentSizeModern>
  );
};
export default ExperimentDateGraph;
