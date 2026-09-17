import type { ExperimentStoppedNotificationPayload } from "shared/validators";
import type { StatsEngine } from "shared/types/stats";
import { formatPercentChange, pValueFormatter } from "shared/util";
import {
  escapeInlineMarkdown,
  markdownToPlainText,
} from "back-end/src/services/notificationCards/markdown";
import { confidenceLabel } from "back-end/src/services/notificationCards/statLabel";

type Results = NonNullable<ExperimentStoppedNotificationPayload["results"]>;
type GoalMetric = NonNullable<
  ExperimentStoppedNotificationPayload["goalMetric"]
>;
type VariationResult = GoalMetric["variations"][number];

export const RESULT_LABEL: Record<Results, string> = {
  won: "Won",
  lost: "Lost",
  inconclusive: "Inconclusive",
  dnf: "Did not finish",
};

// Headline for the banner, image caption, and text: the event plus the result.
export function getExperimentStoppedLabel(
  data: ExperimentStoppedNotificationPayload,
): string {
  if (!data.results) return "Experiment Stopped";
  const result = data.results === "won" ? "Winner" : RESULT_LABEL[data.results];
  return `Experiment Stopped - ${result}`;
}

export const formatLift = formatPercentChange;

// The stat beside the lift: "99.1%" chance to win for Bayesian tests, the
// p-value for frequentist ones. Undefined when the payload lacks it.
export function formatConfidenceValue(
  statsEngine: StatsEngine,
  result: Pick<VariationResult, "chanceToWin" | "pValue">,
): string | undefined {
  if (statsEngine === "frequentist") {
    return result.pValue !== undefined
      ? pValueFormatter(result.pValue)
      : undefined;
  }
  return result.chanceToWin !== undefined
    ? `${(result.chanceToWin * 100).toFixed(1)}%`
    : undefined;
}

// "Chance to win: 99.1%" / "p-value: 0.03" for prose.
export function formatConfidence(
  statsEngine: StatsEngine,
  result: Pick<VariationResult, "chanceToWin" | "pValue">,
): string | undefined {
  const value = formatConfidenceValue(statsEngine, result);
  return value === undefined
    ? undefined
    : `${confidenceLabel(statsEngine)}: ${value}`;
}

// The variation whose lift is worth calling out: the winner on a win, or the
// sole treatment of a two-armed test. Multi-armed losses and inconclusive
// results single nobody out.
export function getExperimentStoppedOutcome(
  data: ExperimentStoppedNotificationPayload,
): VariationResult | undefined {
  const variations = data.goalMetric?.variations ?? [];
  if (data.results === "won" && data.winningVariationIndex !== undefined) {
    return variations.find(
      (v) => v.variationIndex === data.winningVariationIndex,
    );
  }
  return variations.length === 1 ? variations[0] : undefined;
}

// "Variation *X*" - the name in italics, with any markdown characters in the
// name kept literal.
export const variationMarkdown = (name: string): string =>
  `Variation *${escapeInlineMarkdown(name)}*`;

// Markdown conclusion: "Variation *X* won. <reason>". Undefined when there is
// nothing to say.
export function getExperimentStoppedConclusion(
  data: ExperimentStoppedNotificationPayload,
): string | undefined {
  const text = [
    data.results === "won" && data.winningVariationName
      ? `${variationMarkdown(data.winningVariationName)} won.`
      : undefined,
    data.reason ? escapeInlineMarkdown(data.reason) : undefined,
  ]
    .filter(Boolean)
    .join(" ");
  return text || undefined;
}

// "Variation *X*" for the variation a temporary rollout is serving.
export function getExperimentStoppedRollout(
  data: ExperimentStoppedNotificationPayload,
): string | undefined {
  return data.enableTemporaryRollout && data.releasedVariationName
    ? variationMarkdown(data.releasedVariationName)
    : undefined;
}

// "Experiment Stopped - Winner. Variation X won. <reason> Temporary rollout:
// Variation X. Checkout conversion: +6.1% (Chance to win: 99.1%)."
export function getExperimentStoppedText(
  data: ExperimentStoppedNotificationPayload,
): string {
  const conclusion = getExperimentStoppedConclusion(data);
  const rollout = getExperimentStoppedRollout(data);
  const outcome = getExperimentStoppedOutcome(data);
  const goal = data.goalMetric;
  const confidence =
    goal && outcome ? formatConfidence(goal.statsEngine, outcome) : undefined;
  const lift =
    goal && outcome && outcome.uplift !== undefined
      ? `${goal.metricName}: ${formatLift(outcome.uplift)}${
          confidence ? ` (${confidence})` : ""
        }.`
      : undefined;
  return [
    `${getExperimentStoppedLabel(data)}.`,
    conclusion ? markdownToPlainText(conclusion) : undefined,
    rollout ? `Temporary rollout: ${markdownToPlainText(rollout)}.` : undefined,
    lift,
  ]
    .filter(Boolean)
    .join(" ");
}
