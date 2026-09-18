import type { ExperimentStoppedNotificationPayload } from "shared/validators";
import type { StatsEngine } from "shared/types/stats";
import { formatPercentChange, pValueFormatter } from "shared/util";
import { escapeInlineMarkdown } from "back-end/src/services/notificationCards/markdown";
import { confidenceLabel } from "back-end/src/services/notificationCards/statLabel";
import { EXPERIMENT_EVENT_LABELS } from "./experimentEventLabels";

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
  if (!data.results) return EXPERIMENT_EVENT_LABELS.stopped;
  const result = data.results === "won" ? "Winner" : RESULT_LABEL[data.results];
  return `${EXPERIMENT_EVENT_LABELS.stopped} - ${result}`;
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

// "*X*" - the variation name in italics, with any markdown characters in the
// name kept literal. No "Variation" prefix: default names are already
// "Variation 1", "Variation 2", so it would double up.
export const variationMarkdown = (name: string): string =>
  `*${escapeInlineMarkdown(name)}*`;

// Markdown conclusion: "*X* won. <reason>". Undefined when there is nothing
// to say.
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

// "*X*" for the variation a temporary rollout is serving.
export function getExperimentStoppedRollout(
  data: ExperimentStoppedNotificationPayload,
): string | undefined {
  return data.enableTemporaryRollout && data.releasedVariationName
    ? variationMarkdown(data.releasedVariationName)
    : undefined;
}

// "Checkout conversion: +6.1% (Chance to win: 99.1%)" for the variation worth
// calling out, as card markdown. Undefined without a lift to report.
export function getExperimentStoppedGoalLine(
  data: ExperimentStoppedNotificationPayload,
): string | undefined {
  const goal = data.goalMetric;
  const outcome = getExperimentStoppedOutcome(data);
  if (!goal || !outcome || outcome.uplift === undefined) return undefined;
  const confidence = formatConfidence(goal.statsEngine, outcome);
  return `${escapeInlineMarkdown(goal.metricName)}: ${formatLift(
    outcome.uplift,
  )}${confidence ? ` (${confidence})` : ""}`;
}

// Label/value pairs for the text message, in the card's order: the conclusion
// (or the bare result when there is nothing to say), the temporary rollout,
// and the goal metric's headline.
export function getExperimentStoppedTextFields(
  data: ExperimentStoppedNotificationPayload,
): { label: string; value: string }[] {
  const conclusion = getExperimentStoppedConclusion(data);
  const rollout = getExperimentStoppedRollout(data);
  const goal = getExperimentStoppedGoalLine(data);
  const fields = [
    conclusion
      ? { label: "Conclusion", value: conclusion }
      : data.results
        ? { label: "Result", value: RESULT_LABEL[data.results] }
        : undefined,
    rollout ? { label: "Temporary rollout", value: rollout } : undefined,
    goal ? { label: "Goal metric", value: goal } : undefined,
  ].filter((f): f is { label: string; value: string } => f !== undefined);
  return fields.length
    ? fields
    : [{ label: "Result", value: "Stopped without a recorded outcome" }];
}
