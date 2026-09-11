import type { NotificationEvent } from "shared/types/events/notification-events";
import {
  experimentStartedNotificationPayload,
  experimentStoppedNotificationPayload,
  srm,
  experimentInfoSignificance,
} from "shared/validators";
import { getExperimentStartedSummary } from "back-end/src/services/experimentChanges/experimentStartedSummary";
import type { ExperimentCardData } from "./cardImages";

export function buildEventSnapshotCard(
  event: NotificationEvent,
): ExperimentCardData | null {
  if (event.event === "experiment.status.started") {
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
        getExperimentStartedSummary(data),
        ...(data.phaseName ? [`Phase: ${data.phaseName}`] : []),
      ],
    };
  }
  if (event.event === "experiment.status.stopped") {
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
        data.results
          ? `Experiment stopped. Result: ${data.results}.`
          : "Experiment stopped.",
        ...(data.enableTemporaryRollout && data.releasedVariationName
          ? [`Temporary rollout: ${data.releasedVariationName}`]
          : []),
        ...(data.reason ? [data.reason] : []),
      ],
    };
  }
  if (event.event === "experiment.health.srm") {
    const parsed = srm.safeParse(event.data.object);
    if (!parsed.success) return null;
    return {
      state: "warning",
      event: "warning",
      name: parsed.data.experimentName,
      key: parsed.data.experimentId,
      goal: "",
      variants: [],
      rows: [],
      summary: [
        "Sample ratio mismatch detected.",
        `SRM threshold: ${parsed.data.threshold}`,
      ],
    };
  }
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
  return null;
}
