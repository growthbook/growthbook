import type { NotificationEvent } from "shared/types/events/notification-events";
import {
  experimentStartedNotificationPayload,
  experimentStoppedNotificationPayload,
  srm,
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
      badgeLabel: "Stopped",
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
  if (
    event.event === "experiment.warning" &&
    event.data.object.type === "srm"
  ) {
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
  return null;
}
