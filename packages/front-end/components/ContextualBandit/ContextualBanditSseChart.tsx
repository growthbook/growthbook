import { useMemo } from "react";
import { ParentSizeModern } from "@visx/responsive";
import { Group } from "@visx/group";
import { GridRows, GridColumns } from "@visx/grid";
import { scaleLinear } from "@visx/scale";
import { LinePath } from "@visx/shape";
import { GlyphCircle } from "@visx/glyph";
import { AxisBottom, AxisLeft } from "@visx/axis";
import {
  useTooltip,
  TooltipWithBounds,
  defaultStyles as tooltipDefaultStyles,
} from "@visx/tooltip";
import { CONTEXTUAL_BANDIT_COMBINED_ATTRIBUTE_VALUE } from "shared/constants";
import { conditionFromLeafClauses } from "shared/experiments";
import type { ContextualBanditSseStep } from "shared/experiments";
import { Box, Flex } from "@radix-ui/themes";
import Text from "@/ui/Text";
import ConditionDisplay from "@/components/Features/ConditionDisplay";
import styles from "@/components/GraphStyles.module.scss";

const numberFormatter = new Intl.NumberFormat(undefined, {
  maximumSignificantDigits: 4,
});

/** Number of tree leaves at a growth stage (each split adds exactly one leaf). */
function leafCount(step: ContextualBanditSseStep): number {
  return step.numSplits + 1;
}

function displayLevel(level: string): string {
  return level === CONTEXTUAL_BANDIT_COMBINED_ATTRIBUTE_VALUE ? "Other" : level;
}

function displayLevels(levels: string[]): string {
  if (!levels.length) return "—";
  return levels.map(displayLevel).join(", ");
}

export type AttributeSseReduction = {
  /** Stable key for React lists; the raw attribute name or a sentinel for "Other". */
  key: string;
  /** Display label: the attribute name, or "Other" for the combined bucket. */
  label: string;
  isOther: boolean;
  totalReduction: number;
  splitCount: number;
  /** The split steps attributed to this row, for the detail modal. */
  steps: ContextualBanditSseStep[];
};

/**
 * Aggregates the total SSE (within-context error) reduction each attribute
 * contributed.
 */
export function attributeSseReductions(
  steps: ContextualBanditSseStep[],
  topN = 3,
): AttributeSseReduction[] {
  const sorted = [...steps].sort((a, b) => a.numSplits - b.numSplits);
  const byAttr = new Map<
    string,
    { reduction: number; steps: ContextualBanditSseStep[] }
  >();
  for (let i = 1; i < sorted.length; i++) {
    const step = sorted[i];
    if (!step.split) continue;
    const gain = sorted[i - 1].totalSse - step.totalSse;
    const attribute = step.split.attribute;
    const entry = byAttr.get(attribute) ?? { reduction: 0, steps: [] };
    entry.reduction += gain;
    entry.steps.push(step);
    byAttr.set(attribute, entry);
  }

  const ranked: AttributeSseReduction[] = Array.from(byAttr.entries())
    .map(([attribute, { reduction, steps: attrSteps }]) => ({
      key: attribute,
      label: attribute,
      isOther: false,
      totalReduction: reduction,
      splitCount: attrSteps.length,
      steps: attrSteps,
    }))
    .sort((a, b) => b.totalReduction - a.totalReduction);

  if (ranked.length <= topN) return ranked;

  const rest = ranked.slice(topN);
  return [
    ...ranked.slice(0, topN),
    {
      key: "__other__",
      label: "Other",
      isOther: true,
      totalReduction: rest.reduce((sum, r) => sum + r.totalReduction, 0),
      splitCount: rest.reduce((sum, r) => sum + r.splitCount, 0),
      steps: rest.flatMap((r) => r.steps),
    },
  ];
}

/**
 * Renders a single split's details, reused by the SSE plot tooltip and the
 * attribute detail modal.
 *
 * - `variant="tooltip"` (default): leads with the leaf count and total error at
 *   that growth stage, matching the plot's axes, then the split.
 * - `variant="detail"`: leads with the split, then a footer showing the percent
 *   of error the split removed (`percentReducedLabel`) and the resulting leaf
 *   count.
 */
export function SseSplitDetails({
  step,
  variant = "tooltip",
  percentReducedLabel,
}: {
  step: ContextualBanditSseStep;
  variant?: "tooltip" | "detail";
  percentReducedLabel?: string;
}) {
  const isRoot = step.numSplits === 0;
  const condition = useMemo(
    () =>
      step.split
        ? JSON.stringify(conditionFromLeafClauses(step.split.leafClauses))
        : null,
    [step.split],
  );

  const splitBody = step.split ? (
    <>
      <Text size="sm" weight="medium" as="div">
        Split node
      </Text>
      <Box mb="2">
        {!condition || condition === "{}" ? (
          <Text size="sm" color="text-low">
            All contexts
          </Text>
        ) : (
          <ConditionDisplay condition={condition} />
        )}
      </Box>
      <Text size="sm" weight="medium" as="div">
        Split on {step.split.attribute}
      </Text>
      <Text size="sm" color="text-low" as="div">
        {displayLevels(step.split.leftLevels)} vs{" "}
        {displayLevels(step.split.rightLevels)}
      </Text>
    </>
  ) : isRoot ? (
    <Text size="sm" color="text-low" as="div">
      Root of the tree, before any splits.
    </Text>
  ) : (
    <Text size="sm" color="text-low" as="div">
      Split details are unavailable for this point. Refresh results to compute
      them.
    </Text>
  );

  if (variant === "detail") {
    return (
      <Box>
        {splitBody}
        <Box mt="3">
          {percentReducedLabel !== undefined ? (
            <Text size="sm" color="text-low" as="div">
              Percent error reduced {percentReducedLabel}
            </Text>
          ) : null}
          <Text size="sm" color="text-low" as="div">
            {leafCount(step)} leaves in tree after split
          </Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box style={{ maxWidth: 320 }}>
      <Text size="sm" weight="medium" as="div">
        {leafCount(step)} {leafCount(step) === 1 ? "leaf" : "leaves"}
      </Text>
      <Text size="sm" color="text-low" as="div" mb="2">
        Total error {numberFormatter.format(step.totalSse)}
      </Text>
      {splitBody}
    </Box>
  );
}

const margin = { top: 20, right: 24, bottom: 48, left: 88 };

function SseChartInner({
  steps,
  width,
  height,
}: {
  steps: ContextualBanditSseStep[];
  width: number;
  height: number;
}) {
  const {
    tooltipData,
    tooltipLeft,
    tooltipTop,
    tooltipOpen,
    showTooltip,
    hideTooltip,
  } = useTooltip<ContextualBanditSseStep>();

  const data = useMemo(
    () => [...steps].sort((a, b) => a.numSplits - b.numSplits),
    [steps],
  );

  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  const xValues = data.map(leafCount);
  const minLeaves = Math.min(...xValues);
  const maxLeaves = Math.max(...xValues);
  const maxSse = Math.max(...data.map((d) => d.totalSse), 0);

  const xScale = useMemo(
    () =>
      scaleLinear<number>({
        domain: [minLeaves, Math.max(maxLeaves, minLeaves + 1)],
        range: [0, innerWidth],
      }),
    [minLeaves, maxLeaves, innerWidth],
  );

  const yScale = useMemo(
    () =>
      scaleLinear<number>({
        domain: [0, maxSse > 0 ? maxSse : 1],
        range: [innerHeight, 0],
        nice: true,
      }),
    [maxSse, innerHeight],
  );

  if (innerWidth < 10 || innerHeight < 10) return null;

  const maxLeafTicks = 12;
  const leafTickStep = Math.max(
    1,
    Math.ceil((maxLeaves - minLeaves + 1) / maxLeafTicks),
  );
  const leafTickValues: number[] = [];
  for (let v = minLeaves; v <= maxLeaves; v += leafTickStep) {
    leafTickValues.push(v);
  }
  if (leafTickValues[leafTickValues.length - 1] !== maxLeaves) {
    leafTickValues.push(maxLeaves);
  }

  return (
    <div style={{ position: "relative" }}>
      <svg width={width} height={height} style={{ overflow: "visible" }}>
        <Group left={margin.left} top={margin.top}>
          <GridRows
            scale={yScale}
            width={innerWidth}
            height={innerHeight}
            stroke="var(--slate-a5)"
            strokeDasharray="2,2"
            strokeWidth={1}
          />
          <GridColumns
            scale={xScale}
            width={innerWidth}
            height={innerHeight}
            tickValues={leafTickValues}
            stroke="var(--slate-a5)"
            strokeDasharray="2,2"
            strokeWidth={1}
          />

          <AxisLeft
            scale={yScale}
            label="Sum of squared error"
            labelClassName={styles.label}
            labelOffset={64}
            numTicks={5}
            tickFormat={(v) => numberFormatter.format(Number(v))}
            tickLabelProps={() => ({
              fill: "var(--text-color-table)",
              fontSize: 12,
              textAnchor: "end",
              verticalAnchor: "middle",
            })}
          />
          <AxisBottom
            scale={xScale}
            top={innerHeight}
            label="Number of leaves"
            labelClassName={styles.label}
            labelOffset={16}
            tickValues={leafTickValues}
            tickFormat={(v) => String(Math.round(Number(v)))}
            tickLabelProps={() => ({
              fill: "var(--text-color-table)",
              fontSize: 12,
              textAnchor: "middle",
            })}
          />

          <LinePath<ContextualBanditSseStep>
            data={data}
            x={(d) => xScale(leafCount(d))}
            y={(d) => yScale(d.totalSse)}
            stroke="var(--violet-10)"
            strokeWidth={2}
          />

          {data.map((step) => {
            const cx = xScale(leafCount(step));
            const cy = yScale(step.totalSse);
            return (
              <GlyphCircle
                key={`sse-${step.numSplits}`}
                left={cx}
                top={cy}
                size={70}
                fill="var(--violet-10)"
                stroke="#fff"
                strokeWidth={1.5}
                onPointerMove={() =>
                  showTooltip({
                    tooltipData: step,
                    tooltipLeft: cx,
                    tooltipTop: cy,
                  })
                }
                onPointerLeave={hideTooltip}
                style={{ cursor: "pointer" }}
              />
            );
          })}
        </Group>
      </svg>
      {tooltipOpen &&
        tooltipData &&
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
              padding: "10px 12px",
              borderRadius: "6px",
              boxShadow: "var(--shadow-4)",
              pointerEvents: "none",
            }}
          >
            <SseSplitDetails step={tooltipData} />
          </TooltipWithBounds>
        )}
    </div>
  );
}

/**
 * Plots total within-tree SSE (y) against the number of tree leaves (x) across
 * the greedy regression tree's growth stages. Hovering a point reveals the leaf
 * node that was split to reach that stage and how it was partitioned.
 */
export default function ContextualBanditSseChart({
  steps,
  height = 280,
}: {
  steps: ContextualBanditSseStep[];
  height?: number;
}) {
  if (steps.length < 2) return null;

  return (
    <Flex direction="column" style={{ width: "100%" }}>
      <div style={{ width: "100%", height }}>
        <ParentSizeModern>
          {({ width }) =>
            width > 0 ? (
              <SseChartInner steps={steps} width={width} height={height} />
            ) : null
          }
        </ParentSizeModern>
      </div>
    </Flex>
  );
}
