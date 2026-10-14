import {
  type ExperimentStoppedNotificationPayload,
  experimentStoppedNotificationPayload,
} from "shared/validators";
import { getExperimentUrl } from "back-end/src/util/appUrls";
import {
  RESULT_LABEL,
  formatConfidenceValue,
  formatLift,
  getExperimentStoppedConclusion,
  getExperimentStoppedLabel,
  getExperimentStoppedRollout,
  variationMarkdown,
} from "back-end/src/services/experimentChanges/experimentStoppedSummary";
import { escapeInlineMarkdown } from "back-end/src/services/notificationCards/markdown";
import {
  confidenceLabel,
  intervalLabel,
} from "back-end/src/services/notificationCards/statLabel";
import { formatExperimentFooter } from "back-end/src/services/notificationCards/producers/experimentFooter";
import type {
  CardCallout,
  CardData,
  CardField,
  CardIcon,
  CardResultRow,
  CardResults,
  CardSection,
  CardTone,
  NotificationCardProducer,
} from "back-end/src/services/notificationCards/types";

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
): CardResultRow[] {
  return goalMetric.variations.map((v) => {
    const value = formatConfidenceValue(goalMetric.statsEngine, v);
    // Unknown significance (e.g. the goal metric was deleted) stays muted.
    const stat = {
      sig: v.significant ?? false,
      ...(value ? { stat: value } : {}),
    };
    const base: CardResultRow = {
      v: v.variationName,
      i: v.variationIndex,
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
        ? { interval: `[${formatLift(v.ci[0])}, ${formatLift(v.ci[1])}]` }
        : {}),
    };
  });
}

// One axis for every row's distribution, in lift percent. It spans at least
// ±20% so ordinary lifts read the same from card to card, and widens to the
// next multiple of ten when a row's interval or spread runs past that.
function goalAxis(
  goalMetric: NonNullable<ExperimentStoppedNotificationPayload["goalMetric"]>,
): CardResults["axis"] {
  const reach = goalMetric.variations.reduce((max, v) => {
    const spread =
      v.uplift !== undefined && v.upliftStddev !== undefined
        ? Math.abs(toPct(v.uplift)) + 2 * toPct(v.upliftStddev)
        : 0;
    const bounds = v.ci
      ? Math.max(Math.abs(toPct(v.ci[0])), Math.abs(toPct(v.ci[1])))
      : 0;
    return Math.max(max, spread, bounds);
  }, 20);
  const bound = Math.ceil(reach / 10) * 10;
  return {
    domain: [-bound, bound],
    labels: [formatLift(-bound / 100), "0", formatLift(bound / 100)],
  };
}

// The recorded outcome colors the card and picks its glyph.
function outcomeStyle(data: ExperimentStoppedNotificationPayload): {
  tone: CardTone;
  icon: CardIcon;
} {
  switch (data.results) {
    case "won":
      return { tone: "success", icon: "trophy" };
    case "lost":
      return { tone: "danger", icon: "x" };
    case "dnf":
    case "inconclusive":
    case undefined:
      return { tone: "neutral", icon: "stop" };
    default: {
      const exhaustive: never = data.results;
      throw new Error(`Unhandled experiment result: ${exhaustive}`);
    }
  }
}

// The written analysis, plus the variation a temporary rollout serves when one
// is active. Either can stand alone as the callout's primary block.
function getExperimentStoppedCallout(
  data: ExperimentStoppedNotificationPayload,
): CardCallout | undefined {
  const conclusion = getExperimentStoppedConclusion(data);
  const rollout = getExperimentStoppedRollout(data);
  const aside = rollout
    ? { label: "Temporary Rollout", markdown: rollout }
    : undefined;
  if (conclusion) {
    return {
      label: "Conclusion",
      markdown: conclusion,
      ...(aside ? { aside } : {}),
    };
  }
  return aside;
}

function buildCardData(data: ExperimentStoppedNotificationPayload): CardData {
  const footer = formatExperimentFooter(data.totalUsers, data.durationDays);
  const identity = {
    ...outcomeStyle(data),
    name: data.experimentName,
    banner: getExperimentStoppedLabel(data),
    url: getExperimentUrl(data.experimentId),
    ...(footer ? { footer } : {}),
  };
  // No successful snapshot at stop time: report the outcome as labeled fields
  // rather than a results table with nothing in it.
  if (!data.goalMetric) {
    return {
      ...identity,
      sections: [{ kind: "fields", fields: getExperimentStoppedFields(data) }],
    };
  }
  const callout = getExperimentStoppedCallout(data);
  const { rows, note } = capRows(
    goalRows(data.goalMetric),
    data.winningVariationIndex,
  );
  const results: CardSection = {
    kind: "results",
    results: {
      sectionLabel: "Goal metric",
      title: data.goalMetric.metricName,
      statLabel: confidenceLabel(data.goalMetric.statsEngine),
      changeLabel: "Lift",
      intervalLabel: intervalLabel(
        data.goalMetric.statsEngine,
        data.goalMetric.pValueThreshold,
      ),
      rows,
      ...(note ? { note } : {}),
      axis: goalAxis(data.goalMetric),
    },
  };
  // With a conclusion, the card grows sideways: prose on the left, results on
  // the right, so a tall table does not shrink the whole image in chat.
  return {
    ...identity,
    sections: callout
      ? [
          {
            kind: "columns",
            left: [{ kind: "callout", callout }],
            right: [results],
          },
        ]
      : [results],
  };
}

// Rows beyond this are summarized in a note so a many-armed test stays a
// readable height. The winning variation is always among the rows shown.
const MAX_RESULT_ROWS = 4;

function capRows(
  rows: CardResultRow[],
  winnerIndex: number | undefined,
): { rows: CardResultRow[]; note?: string } {
  if (rows.length <= MAX_RESULT_ROWS) return { rows };
  const shown = rows.slice(0, MAX_RESULT_ROWS);
  const winner = rows.find((r) => r.i === winnerIndex);
  if (winner && !shown.includes(winner)) shown[MAX_RESULT_ROWS - 1] = winner;
  const hidden = rows.length - shown.length;
  return {
    rows: shown,
    note: `+${hidden} more variation${hidden === 1 ? "" : "s"}`,
  };
}

// Built from the immutable stop payload. Reports the recorded result and any
// temporary rollout without claiming an undeployed variation shipped, and
// shows the top goal metric's results when the payload captured them.
export const buildExperimentStoppedCard: NotificationCardProducer = (event) => {
  const parsed = experimentStoppedNotificationPayload.safeParse(
    event.data.object,
  );
  return parsed.success ? buildCardData(parsed.data) : null;
};
