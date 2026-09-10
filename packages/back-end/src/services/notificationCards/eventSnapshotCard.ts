import type { NotificationEvent } from "shared/types/events/notification-events";
import {
  experimentInfoSignificance,
  experimentStartedNotificationPayload,
  experimentStoppedNotificationPayload,
} from "shared/validators";
import type { ExperimentCardData } from "./cardImages";

export function buildEventSnapshotCard(
  event: NotificationEvent,
): ExperimentCardData | null {
  if (event.event === "experiment.info.significance") {
    const parsed = experimentInfoSignificance.safeParse(event.data.object);
    if (!parsed.success) return null;
    const data = parsed.data;
    // Older queued events lack immutable results. Never substitute today's snapshot.
    if (
      !["frequentist", "bayesian"].includes(data.statsEngine) ||
      !data.snapshotId ||
      data.differenceType !== "relative" ||
      data.uplift === undefined ||
      !Number.isFinite(data.uplift)
    )
      return null;
    const summary = [
      `${data.metricName} · ${data.variationName}`,
      `Relative change: ${(data.uplift * 100).toFixed(2)}%`,
      data.statsEngine === "frequentist"
        ? `p-value: ${data.criticalValue.toPrecision(3)}`
        : `Chance to beat baseline: ${(data.criticalValue * 100).toFixed(1)}%`,
      data.winning
        ? "Statistically significant improvement"
        : "Statistically significant regression",
    ];
    return {
      sentiment: data.winning ? "positive" : "negative",
      state: "running",
      event: "significance",
      name: data.experimentName,
      key: data.experimentId,
      goal: data.metricName,
      variants: [data.variationName],
      rows: [],
      summary,
    };
  }
  if (event.event === "experiment.started") {
    const parsed = experimentStartedNotificationPayload.safeParse(
      event.data.object,
    );
    if (!parsed.success) return null;
    const data = parsed.data;
    return {
      state: "started",
      event: "started",
      name: data.experimentName,
      key: data.experimentId,
      goal: "",
      variants: [],
      rows: [],
      summary: [
        `Started with ${data.variationCount} variations.`,
        ...(data.phaseName ? [`Phase: ${data.phaseName}`] : []),
      ],
    };
  }
  if (event.event === "experiment.stopped") {
    const parsed = experimentStoppedNotificationPayload.safeParse(
      event.data.object,
    );
    if (!parsed.success) return null;
    const data = parsed.data;
    return {
      state: "stopped",
      event: "stopped",
      name: data.experimentName,
      key: data.experimentId,
      goal: "",
      variants: [],
      rows: [],
      summary: [
        `Experiment stopped. Result: ${data.results}.`,
        ...(data.enableTemporaryRollout && data.releasedVariationName
          ? [`Temporary rollout: ${data.releasedVariationName}`]
          : []),
        ...(data.reason ? [data.reason] : []),
      ],
    };
  }
  return null;
}
