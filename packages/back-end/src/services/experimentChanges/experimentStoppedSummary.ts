import type { ExperimentStoppedNotificationPayload } from "shared/validators";
import { pValueFormatter } from "shared/util";
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

const RESULT_BANNER: Record<Results, string> = {
  won: "Experiment Stopped - Winner",
  lost: "Experiment Stopped - Lost",
  inconclusive: "Experiment Stopped - Inconclusive",
  dnf: "Experiment Stopped - Did Not Finish",
};

// Headline for the banner, image caption, and text: the event plus the result.
export function getExperimentStoppedLabel(
  data: ExperimentStoppedNotificationPayload,
): string {
  return data.results ? RESULT_BANNER[data.results] : "Experiment Stopped";
}

// Relative lift as a signed percent with one decimal, trailing zero dropped:
// 0.061 -> "+6.1%", -0.08 -> "-8%".
export function formatLift(fraction: number): string {
  const pct = Math.round(fraction * 1000) / 10;
  return `${pct > 0 ? "+" : ""}${pct}%`;
}

// The stat beside the lift: "99.1%" chance to win for Bayesian tests, the
// p-value for frequentist ones. Undefined when the payload lacks it.
export function formatConfidenceValue(
  statsEngine: string,
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
  statsEngine: string,
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

// Markdown conclusion: "Variation *X* won. <reason> Temporary rollout:
// Variation *X*." Undefined when there is nothing to say.
export function getExperimentStoppedConclusion(
  data: ExperimentStoppedNotificationPayload,
): string | undefined {
  const text = [
    data.results === "won" && data.winningVariationName
      ? `${variationMarkdown(data.winningVariationName)} won.`
      : undefined,
    data.reason ? escapeInlineMarkdown(data.reason) : undefined,
    data.enableTemporaryRollout && data.releasedVariationName
      ? `Temporary rollout: ${variationMarkdown(data.releasedVariationName)}.`
      : undefined,
  ]
    .filter(Boolean)
    .join(" ");
  return text || undefined;
}

// "Experiment Stopped - Winner. Variation X won. <reason> Temporary rollout:
// Variation X. Checkout conversion: +6.1% (Chance to win: 99.1%)."
export function getExperimentStoppedText(
  data: ExperimentStoppedNotificationPayload,
): string {
  const conclusion = getExperimentStoppedConclusion(data);
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
    lift,
  ]
    .filter(Boolean)
    .join(" ");
}
