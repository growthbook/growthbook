import {
  type ExperimentStoppedNotificationPayload,
  experimentStoppedNotificationPayload,
} from "shared/validators";
import { APP_ORIGIN } from "back-end/src/util/secrets";
import type {
  CardData,
  CardGoalRow,
  NotificationCard,
  NotificationCardProducer,
} from "back-end/src/services/notificationCards/types";

const LABEL = "Experiment stopped";

const RESULT_BANNER: Record<
  NonNullable<ExperimentStoppedNotificationPayload["results"]>,
  string
> = {
  won: "Experiment Stopped - Winner",
  lost: "Experiment Stopped - Lost",
  inconclusive: "Experiment Stopped - Inconclusive",
  dnf: "Experiment Stopped - Did Not Finish",
};

const pct = (v: number): string =>
  (v > 0 ? "+" : "") + Math.round(v * 10) / 10 + "%";
// Fraction -> percent without binary float noise (0.14 * 100 = 14.000000000000002).
const toPct = (fraction: number): number =>
  Math.round(fraction * 100000) / 1000;
const compact = (n: number | undefined): string | undefined =>
  n === undefined || !Number.isFinite(n)
    ? undefined
    : new Intl.NumberFormat("en-US", {
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(n);

export function getExperimentStoppedSummary(
  data: ExperimentStoppedNotificationPayload,
): string[] {
  return [
    data.results
      ? `Experiment stopped. Result: ${data.results}.`
      : "Experiment stopped.",
    ...(data.enableTemporaryRollout && data.releasedVariationName
      ? [`Temporary rollout: ${data.releasedVariationName}`]
      : []),
    ...(data.reason ? [data.reason] : []),
  ];
}

// Goal-metric rows for the results renderer, straight from the immutable
// payload. Relative numbers arrive as fractions and the card wants percents.
function goalRows(
  goalMetric: NonNullable<ExperimentStoppedNotificationPayload["goalMetric"]>,
): CardGoalRow[] {
  return goalMetric.variations.map((v) => {
    const upliftPct = toPct(v.uplift ?? 0);
    const ci = v.ci ? { lo: toPct(v.ci[0]), hi: toPct(v.ci[1]) } : undefined;
    return {
      v: v.variationName,
      i: v.variationIndex,
      ctrl: goalMetric.control.formattedValue,
      vr: v.formattedValue,
      cn: compact(goalMetric.control.users),
      vn: compact(v.users),
      ...(v.chanceToWin !== undefined
        ? { ctw: `${(v.chanceToWin * 100).toFixed(1)}%` }
        : {}),
      chg: pct(upliftPct),
      dir: upliftPct >= 0 ? "up" : "down",
      ...(v.upliftStddev !== undefined
        ? { vio: { c: upliftPct, s: Math.max(0.3, v.upliftStddev * 100) } }
        : {}),
      ...(ci ? { ci: { ...ci, pt: upliftPct } } : {}),
    };
  });
}

function buildCardData(data: ExperimentStoppedNotificationPayload): CardData {
  const banner = data.results
    ? RESULT_BANNER[data.results]
    : "Experiment Stopped";
  const summary = getExperimentStoppedSummary(data);
  const identity = {
    name: data.experimentName,
    key: data.experimentId,
    banner,
  };
  if (!data.goalMetric) {
    return { ...identity, state: "stopped", event: "stopped", summary };
  }
  const state =
    data.results === "won"
      ? "winner"
      : data.results === "lost"
        ? "loser"
        : "stopped";
  const rollout =
    data.enableTemporaryRollout && data.releasedVariationName
      ? `Temporary rollout: ${data.releasedVariationName}.`
      : undefined;
  return {
    ...identity,
    state,
    event: state === "winner" ? "won" : state === "loser" ? "lost" : "stopped",
    goal: data.goalMetric.metricName,
    variants: [
      data.goalMetric.control.variationName,
      ...data.goalMetric.variations.map((v) => v.variationName),
    ],
    rows: goalRows(data.goalMetric),
    users: compact(data.totalUsers),
    ...(data.winningVariationName
      ? { winningVariation: data.winningVariationName }
      : {}),
    ...(data.winningVariationIndex !== undefined
      ? { winningVariationIndex: data.winningVariationIndex }
      : {}),
    // The stop reason is the closest thing to a written conclusion; the
    // rollout note rides along so the compact hero can show it too.
    ...(data.reason || rollout
      ? {
          conclusion: {
            text: [data.reason, rollout].filter(Boolean).join(" "),
          },
        }
      : {}),
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
  return {
    data: buildCardData(data),
    altText: `${data.experimentName} - ${LABEL}`,
    objectUrl: `${APP_ORIGIN}/experiment/${data.experimentId}`,
    objectName: data.experimentName,
    eventLabel: LABEL,
  };
};
