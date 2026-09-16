import type { ExperimentStoppedNotificationPayload } from "shared/validators";
import { pValueFormatter } from "shared/util";

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

// Chance to win for Bayesian tests, p-value for frequentist; one phrasing
// everywhere.
export function formatConfidence(
  statsEngine: string,
  result: Pick<VariationResult, "chanceToWin" | "pValue">,
): string | undefined {
  if (statsEngine === "frequentist") {
    return result.pValue !== undefined
      ? `p-value: ${pValueFormatter(result.pValue)}`
      : undefined;
  }
  return result.chanceToWin !== undefined
    ? `Chance to win: ${(result.chanceToWin * 100).toFixed(1)}%`
    : undefined;
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

// Markdown conclusion: "Variation *X* won. <reason> Temporary rollout:
// Variation *X*." Undefined when there is nothing to say.
export function getExperimentStoppedConclusion(
  data: ExperimentStoppedNotificationPayload,
): string | undefined {
  const text = [
    data.results === "won" && data.winningVariationName
      ? `Variation *${data.winningVariationName}* won.`
      : undefined,
    data.reason,
    data.enableTemporaryRollout && data.releasedVariationName
      ? `Temporary rollout: Variation *${data.releasedVariationName}*.`
      : undefined,
  ]
    .filter(Boolean)
    .join(" ");
  return text || undefined;
}

// Strip the inline markdown the card renders, for plain-text channels.
export const stripInlineMarkdown = (s: string): string =>
  s.replace(/\*\*(.+?)\*\*/g, "$1").replace(/\*(.+?)\*/g, "$1");

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
    conclusion ? stripInlineMarkdown(conclusion) : undefined,
    lift,
  ]
    .filter(Boolean)
    .join(" ");
}
