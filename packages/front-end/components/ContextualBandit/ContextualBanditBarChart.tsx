import { useMemo } from "react";
import { ParentSizeModern } from "@visx/responsive";
import { Group } from "@visx/group";
import { GridColumns } from "@visx/grid";
import { scaleBand, scaleLinear } from "@visx/scale";
import { Bar } from "@visx/shape";
import { AxisBottom } from "@visx/axis";
import {
  useTooltip,
  TooltipWithBounds,
  defaultStyles as tooltipDefaultStyles,
} from "@visx/tooltip";
import { ApiContextualBanditInterface } from "shared/validators";
import Text from "@/ui/Text";
import VariationLabel from "@/ui/VariationLabel";
import { getVariationColor } from "@/services/features";

const numberFormatter = new Intl.NumberFormat();

type BarDatum = {
  id: string;
  index: number;
  name: string;
  value: number | null;
  units: number;
};

const margin = { top: 8, right: 56, bottom: 36, left: 128 };
const ROW_HEIGHT = 34;

function BarChartInner({
  data,
  width,
  height,
  unitDisplayName,
  valueLabel,
  formatValue,
}: {
  data: BarDatum[];
  width: number;
  height: number;
  unitDisplayName: string;
  valueLabel: string;
  formatValue: (value: number) => string;
}) {
  const {
    tooltipData,
    tooltipLeft,
    tooltipTop,
    tooltipOpen,
    showTooltip,
    hideTooltip,
  } = useTooltip<BarDatum>();

  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  const values = data
    .map((d) => d.value)
    .filter((v): v is number => v !== null);
  const maxValue = Math.max(...values, 0);
  const minValue = Math.min(...values, 0);

  const yScale = useMemo(
    () =>
      scaleBand<string>({
        domain: data.map((d) => d.id),
        range: [0, innerHeight],
        padding: 0.3,
      }),
    [data, innerHeight],
  );

  const xScale = useMemo(
    () =>
      scaleLinear<number>({
        domain: [minValue, maxValue > minValue ? maxValue : minValue + 1],
        range: [0, innerWidth],
        nice: true,
      }),
    [minValue, maxValue, innerWidth],
  );

  if (innerWidth < 10 || innerHeight < 10) return null;

  const baseline = xScale(0);
  const labelWidth = margin.left - 10;

  return (
    <div style={{ position: "relative" }}>
      <svg width={width} height={height} style={{ overflow: "visible" }}>
        <Group left={margin.left} top={margin.top}>
          <GridColumns
            scale={xScale}
            width={innerWidth}
            height={innerHeight}
            stroke="var(--slate-a5)"
            strokeDasharray="2,2"
            strokeWidth={1}
          />

          <AxisBottom
            scale={xScale}
            top={innerHeight}
            numTicks={5}
            tickFormat={(v) => formatValue(Number(v))}
            tickLabelProps={() => ({
              fill: "var(--text-color-table)",
              fontSize: 12,
              textAnchor: "middle",
            })}
          />

          {data.map((d) => {
            const y = yScale(d.id) ?? 0;
            const barHeight = yScale.bandwidth();
            const cy = y + barHeight / 2;

            const valueX = d.value === null ? baseline : xScale(d.value);
            const barX = Math.min(baseline, valueX);
            const barWidth = Math.abs(valueX - baseline);
            const isNegative = (d.value ?? 0) < 0;

            return (
              <Group key={d.id}>
                <foreignObject
                  x={-margin.left}
                  y={y}
                  width={labelWidth}
                  height={barHeight}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "flex-end",
                      height: "100%",
                    }}
                  >
                    <VariationLabel
                      number={d.index}
                      name={d.name}
                      size="sm"
                      maxWidth={`${labelWidth}px`}
                    />
                  </div>
                </foreignObject>

                {d.value === null ? (
                  <text
                    x={baseline + 6}
                    y={cy}
                    dominantBaseline="middle"
                    fontSize={12}
                    fill="var(--text-color-table)"
                  >
                    —
                  </text>
                ) : (
                  <>
                    <Bar
                      x={barX}
                      y={y}
                      width={barWidth}
                      height={barHeight}
                      rx={3}
                      fill={getVariationColor(d.index, true)}
                      onPointerMove={() =>
                        showTooltip({
                          tooltipData: d,
                          tooltipLeft: isNegative ? barX : valueX,
                          tooltipTop: cy,
                        })
                      }
                      onPointerLeave={hideTooltip}
                      style={{ cursor: "pointer" }}
                    />
                    <text
                      x={isNegative ? valueX - 6 : valueX + 6}
                      y={cy}
                      dominantBaseline="middle"
                      textAnchor={isNegative ? "end" : "start"}
                      fontSize={12}
                      fill="var(--text-color-table)"
                    >
                      {formatValue(d.value)}
                    </text>
                  </>
                )}
              </Group>
            );
          })}
        </Group>
      </svg>
      {tooltipOpen &&
        tooltipData &&
        tooltipData.value !== null &&
        tooltipLeft != null &&
        tooltipTop != null && (
          <TooltipWithBounds
            top={tooltipTop + margin.top}
            left={tooltipLeft + margin.left}
            style={{
              ...tooltipDefaultStyles,
              background: "var(--color-panel-solid)",
              color: "var(--color-text-high)",
              border: "1px solid var(--gray-a5)",
              padding: "8px 10px",
              borderRadius: "6px",
              boxShadow: "var(--shadow-4)",
              pointerEvents: "none",
            }}
          >
            <Text size="sm" weight="medium" as="div">
              {tooltipData.name}
            </Text>
            <Text size="sm" color="text-low" as="div">
              {formatValue(tooltipData.value)} {valueLabel}
            </Text>
            <Text size="sm" color="text-low" as="div">
              {numberFormatter.format(tooltipData.units)}{" "}
              {unitDisplayName.toLowerCase()}
            </Text>
          </TooltipWithBounds>
        )}
    </div>
  );
}

/**
 * Horizontal bar chart of a per-variation value (e.g. overall weights or means),
 * sorted descending with variations missing a value listed last. Carries the
 * same information as the corresponding overall cards, with units on hover.
 */
export default function ContextualBanditBarChart({
  variations,
  values,
  units,
  unitDisplayName,
  valueLabel,
  formatValue,
}: {
  variations: ApiContextualBanditInterface["variations"];
  values: (number | null)[];
  units: number[];
  unitDisplayName: string;
  valueLabel: string;
  formatValue: (value: number) => string;
}) {
  const data: BarDatum[] = useMemo(
    () =>
      variations
        .map((v, index) => ({
          id: v.id,
          index,
          name: v.name,
          value: values[index] ?? null,
          units: units[index] ?? 0,
        }))
        .sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity)),
    [variations, values, units],
  );

  if (!data.length) return null;

  const height = margin.top + margin.bottom + data.length * ROW_HEIGHT;

  return (
    <div style={{ width: "100%", height }}>
      <ParentSizeModern>
        {({ width }) =>
          width > 0 ? (
            <BarChartInner
              data={data}
              width={width}
              height={height}
              unitDisplayName={unitDisplayName}
              valueLabel={valueLabel}
              formatValue={formatValue}
            />
          ) : null
        }
      </ParentSizeModern>
    </div>
  );
}
