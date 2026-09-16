import {
  type ExperimentStoppedNotificationPayload,
  experimentStoppedNotificationPayload,
} from "shared/validators";
import { APP_ORIGIN } from "back-end/src/util/secrets";
import {
  RESULT_LABEL,
  formatConfidence,
  formatLift,
  getExperimentStoppedConclusion,
  getExperimentStoppedLabel,
} from "back-end/src/services/experimentChanges/experimentStoppedSummary";
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

// Significance thresholds for coloring the stat cell. The payload does not
// carry the org's configured thresholds, so these are the GrowthBook defaults.
const P_VALUE_THRESHOLD = 0.05;
const CHANCE_TO_WIN_THRESHOLD = 0.95;

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
            value: `Variation *${data.releasedVariationName}*`,
          },
        ]
      : []),
    ...(data.reason ? [{ label: "Reason", value: data.reason }] : []),
  ];
  return fields.length
    ? fields
    : [{ label: "Result", value: "Stopped without a recorded outcome" }];
}

// Goal-metric rows for the results renderer, straight from the immutable
// payload. Relative numbers arrive as fractions and the card wants percents.
// The stat column holds chance to win (Bayesian) or the p-value (frequentist).
function goalRows(
  goalMetric: NonNullable<ExperimentStoppedNotificationPayload["goalMetric"]>,
): CardGoalRow[] {
  const frequentist = goalMetric.statsEngine === "frequentist";
  return goalMetric.variations.map((v) => {
    const upliftPct = toPct(v.uplift ?? 0);
    const ci = v.ci ? { lo: toPct(v.ci[0]), hi: toPct(v.ci[1]) } : undefined;
    const confidence = formatConfidence(goalMetric.statsEngine, v);
    const stat = confidence
      ? {
          // The cell shows just the number; the header carries the label.
          ctw: confidence.replace(/^[^:]+: /, ""),
          sig: frequentist
            ? (v.pValue ?? 1) < P_VALUE_THRESHOLD
            : (v.chanceToWin ?? 0.5) >= CHANCE_TO_WIN_THRESHOLD ||
              (v.chanceToWin ?? 0.5) <= 1 - CHANCE_TO_WIN_THRESHOLD,
        }
      : {};
    return {
      v: v.variationName,
      i: v.variationIndex,
      ctrl: goalMetric.control.formattedValue,
      vr: v.formattedValue,
      cn: compact(goalMetric.control.users),
      vn: compact(v.users),
      ...stat,
      chg: formatLift(v.uplift ?? 0),
      dir: upliftPct >= 0 ? "up" : "down",
      ...(v.upliftStddev !== undefined
        ? { vio: { c: upliftPct, s: Math.max(0.3, v.upliftStddev * 100) } }
        : {}),
      ...(ci ? { ci: { ...ci, pt: upliftPct } } : {}),
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
      event: "stopped",
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
    event: state === "winner" ? "won" : state === "loser" ? "lost" : "stopped",
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
    ...(data.winningVariationName
      ? { winningVariation: data.winningVariationName }
      : {}),
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
