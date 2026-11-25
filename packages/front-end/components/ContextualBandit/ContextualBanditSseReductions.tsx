import { useMemo } from "react";
import { CONTEXTUAL_BANDIT_COMBINED_ATTRIBUTE_VALUE } from "shared/constants";
import { conditionFromLeafClauses } from "shared/experiments";
import type { ContextualBanditSseStep } from "shared/experiments";
import { Box } from "@radix-ui/themes";
import { Trans, useLingui } from "@lingui/react/macro";
import Text from "@/ui/Text";
import ConditionDisplay from "@/components/Features/ConditionDisplay";

/** Number of tree leaves at a growth stage (each split adds exactly one leaf). */
function leafCount(step: ContextualBanditSseStep): number {
  return step.numSplits + 1;
}

function displayLevel(level: string, otherLabel: string): string {
  return level === CONTEXTUAL_BANDIT_COMBINED_ATTRIBUTE_VALUE
    ? otherLabel
    : level;
}

function displayLevels(levels: string[], otherLabel: string): string {
  if (!levels.length) return "—";
  return levels.map((level) => displayLevel(level, otherLabel)).join(", ");
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
 * Aggregates the SSE (within-context error) reduction each
 * attribute contributed, using data from variations with enough units to enter tree building.
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
 * Renders a single split's details for the attribute detail modal: the split
 * itself, followed by a footer showing the percent of error the split removed
 * (`percentReducedLabel`) and the resulting leaf count.
 */
export function SseSplitDetails({
  step,
  percentReducedLabel,
}: {
  step: ContextualBanditSseStep;
  percentReducedLabel?: string;
}) {
  const { t } = useLingui();
  const otherLabel = t`Other`;
  const isRoot = step.numSplits === 0;
  const condition = useMemo(
    () =>
      step.split
        ? JSON.stringify(conditionFromLeafClauses(step.split.leafClauses))
        : null,
    [step.split],
  );

  const splitAttribute = step.split?.attribute ?? "";
  const leftLevels = step.split
    ? displayLevels(step.split.leftLevels, otherLabel)
    : "";
  const rightLevels = step.split
    ? displayLevels(step.split.rightLevels, otherLabel)
    : "";
  const leaves = leafCount(step);

  const splitBody = step.split ? (
    <>
      <Text size="sm" weight="medium" as="div">
        <Trans>Split node</Trans>
      </Text>
      <Box mb="2">
        {!condition || condition === "{}" ? (
          <Text size="sm" color="text-low">
            <Trans>All contexts</Trans>
          </Text>
        ) : (
          <ConditionDisplay condition={condition} />
        )}
      </Box>
      <Text size="sm" weight="medium" as="div">
        <Trans>Split on {splitAttribute}</Trans>
      </Text>
      <Text size="sm" color="text-low" as="div">
        <Trans>
          {leftLevels} vs {rightLevels}
        </Trans>
      </Text>
    </>
  ) : isRoot ? (
    <Text size="sm" color="text-low" as="div">
      <Trans>Root of the tree, before any splits.</Trans>
    </Text>
  ) : (
    <Text size="sm" color="text-low" as="div">
      <Trans>
        Split details are unavailable for this point. Refresh results to compute
        them.
      </Trans>
    </Text>
  );

  return (
    <Box>
      {splitBody}
      <Box mt="3">
        {percentReducedLabel !== undefined ? (
          <Text size="sm" color="text-low" as="div">
            <Trans>Percent error reduced {percentReducedLabel}</Trans>
          </Text>
        ) : null}
        <Text size="sm" color="text-low" as="div">
          <Trans>{leaves} leaves in tree after split</Trans>
        </Text>
      </Box>
    </Box>
  );
}
