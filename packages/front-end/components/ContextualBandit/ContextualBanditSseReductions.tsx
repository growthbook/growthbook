import { useMemo } from "react";
import { CONTEXTUAL_BANDIT_COMBINED_ATTRIBUTE_VALUE } from "shared/constants";
import { conditionFromLeafClauses } from "shared/experiments";
import type { ContextualBanditSseStep } from "shared/experiments";
import { Box } from "@radix-ui/themes";
import Text from "@/ui/Text";
import ConditionDisplay from "@/components/Features/ConditionDisplay";

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
 * Renders a single split's details, reused by the attribute detail modal.
 *
 * - `variant="tooltip"` (default): leads with the leaf count and total error at
 *   that growth stage, then the split.
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
