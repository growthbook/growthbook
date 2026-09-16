import {
  type ExperimentStoppedNotificationPayload,
  experimentStoppedNotificationPayload,
} from "shared/validators";
import { APP_ORIGIN } from "back-end/src/util/secrets";
import {
  RESULT_LABEL,
  formatConfidenceValue,
  formatLift,
  getExperimentStoppedConclusion,
  getExperimentStoppedLabel,
  variationMarkdown,
} from "back-end/src/services/experimentChanges/experimentStoppedSummary";
import { escapeInlineMarkdown } from "back-end/src/services/notificationCards/markdown";
import type {
  CardData,
  CardField,
  CardGoalRow,
  NotificationCard,
  NotificationCardProducer,
} from "back-end/src/services/notificationCards/types";

const compact = (n: number | undefined): string | undefined =>
  n === undefined || !Number.isFinite(n)
    ? undefined
    : new Intl.NumberFormat("en-US", {
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(n);

// Fraction -> percent without binary float noise (0.14 * 100 = 14.000000000000002).
const toPct = (fraction: number): number =>
  Math.round(fraction * 100000) / 1000;

// Labeled fields for a stop with no snapshot evidence to chart.
function getExperimentStoppedFields(
  data: ExperimentStoppedNotificationPayload,
): CardField[] {
  const fields: CardField[] = [
    ...(data.results
      ? [{ label: "Result", value: RESULT_LABEL[data.results] }]
      : []),
    ...(data.enableTemporaryRollout && data.releasedVariationName
      ? [
          {
            label: "Temporary rollout",
            value: variationMarkdown(data.releasedVariationName),
          },
        ]
      : []),
    ...(data.reason
      ? [{ label: "Reason", value: escapeInlineMarkdown(data.reason) }]
      : []),
  ];
  return fields.length
    ? fields
    : [{ label: "Result", value: "Stopped without a recorded outcome" }];
}

// Goal-metric rows for the results renderer, straight from the immutable
// payload. Relative numbers arrive as fractions and the card wants percents.
// The stat column holds chance to win (Bayesian) or the p-value (frequentist),
// colored by the significance the payload recorded and the metric's desired
// direction. A variation with no lift estimate renders as a dash rather than
// a fabricated 0%.
function goalRows(
  goalMetric: NonNullable<ExperimentStoppedNotificationPayload["goalMetric"]>,
): CardGoalRow[] {
  return goalMetric.variations.map((v) => {
    const ctw = formatConfidenceValue(goalMetric.statsEngine, v);
    const stat = ctw
      ? { ctw, ...(v.significant !== undefined ? { sig: v.significant } : {}) }
      : {};
    const base: CardGoalRow = {
      v: v.variationName,
      i: v.variationIndex,
      cn: compact(goalMetric.control.users),
      vn: compact(v.users),
      ...stat,
    };
    if (v.uplift === undefined) return base;
    const upliftPct = toPct(v.uplift);
    const up = upliftPct >= 0;
    return {
      ...base,
      chg: formatLift(v.uplift),
      dir: up ? "up" : "down",
      good: goalMetric.inverse ? !up : up,
      ...(v.upliftStddev !== undefined
        ? { vio: { c: upliftPct, s: Math.max(0.3, v.upliftStddev * 100) } }
        : {}),
      ...(v.ci
        ? { ci: { lo: toPct(v.ci[0]), hi: toPct(v.ci[1]), pt: upliftPct } }
        : {}),
    };
  });
}

function buildCardData(data: ExperimentStoppedNotificationPayload): CardData {
  const banner = getExperimentStoppedLabel(data);
  const identity = {
    name: data.experimentName,
    key: data.experimentId,
    banner,
    ...(data.totalUsers !== undefined ? { units: data.totalUsers } : {}),
    ...(data.durationDays !== undefined
      ? { durationDays: data.durationDays }
      : {}),
  };
  if (!data.goalMetric) {
    return {
      ...identity,
      state: "stopped",
      fields: getExperimentStoppedFields(data),
    };
  }
  const state =
    data.results === "won"
      ? "winner"
      : data.results === "lost"
        ? "loser"
        : "stopped";
  const conclusion = getExperimentStoppedConclusion(data);
  return {
    ...identity,
    state,
    goal: data.goalMetric.metricName,
    statsEngine:
      data.goalMetric.statsEngine === "frequentist"
        ? "frequentist"
        : "bayesian",
    variants: [
      data.goalMetric.control.variationName,
      ...data.goalMetric.variations.map((v) => v.variationName),
    ],
    rows: goalRows(data.goalMetric),
    ...(data.winningVariationIndex !== undefined
      ? { winningVariationIndex: data.winningVariationIndex }
      : {}),
    ...(conclusion ? { conclusion: { text: conclusion } } : {}),
  };
}

// Built from the immutable stop payload. Reports the recorded result and any
// temporary rollout without claiming an undeployed variation shipped, and
// shows the top goal metric's results when the payload captured them.
export const buildExperimentStoppedCard: NotificationCardProducer = (
  event,
): NotificationCard | null => {
  if (event.event !== "experiment.status.stopped") return null;
  const parsed = experimentStoppedNotificationPayload.safeParse(
    event.data.object,
  );
  if (!parsed.success) return null;
  const data = parsed.data;
  const label = getExperimentStoppedLabel(data);
  return {
    data: buildCardData(data),
    altText: `${data.experimentName} - ${label}`,
    objectUrl: `${APP_ORIGIN}/experiment/${data.experimentId}`,
    objectName: data.experimentName,
    eventLabel: label,
  };
};
