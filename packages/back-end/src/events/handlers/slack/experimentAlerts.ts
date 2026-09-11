import type { NotificationEvent } from "shared/types/events/notification-events";
import { getExperimentStartedSummary } from "back-end/src/services/experimentChanges/experimentStartedSummary";
import { APP_ORIGIN } from "back-end/src/util/secrets";
import type { SlackMessage } from "./slack-event-handler-utils";

type AlertName =
  | "experiment.status.started"
  | "experiment.status.stopped"
  | "experiment.status.endingSoon"
  | "experiment.status.stale"
  | "experiment.health.updateFailure"
  | "experiment.health.srm"
  | "experiment.health.multipleExposures"
  | "experiment.metric.guardrailFailure"
  | "experiment.bandit.weightsChanged";

type AlertEvent = Extract<NotificationEvent, { event: AlertName }>;

export function buildExperimentAlertMessage(event: AlertEvent): SlackMessage {
  const object = event.data.object;
  let detail: string;
  switch (event.event) {
    case "experiment.status.started":
      detail = getExperimentStartedSummary(event.data.object);
      break;
    case "experiment.status.stopped": {
      const data = event.data.object;
      detail = data.results ? `Stopped. Result: ${data.results}.` : "Stopped.";
      if (data.enableTemporaryRollout && data.releasedVariationName) {
        detail += ` Temporary rollout: ${data.releasedVariationName}.`;
      }
      if (data.reason) detail += ` ${data.reason}`;
      break;
    }
    case "experiment.status.endingSoon":
      detail = `Scheduled to end soon at ${event.data.object.endsAt}.`;
      break;
    case "experiment.status.stale":
      detail = `Running for ${event.data.object.daysRunning} days. Review whether to stop or extend it.`;
      break;
    case "experiment.health.updateFailure":
      detail = {
        query: "Results failed to update because database queries failed.",
        analysis: "Results failed to update because analysis failed.",
        "no-queries":
          "Results failed to update because no queries were generated.",
      }[event.data.object.cause];
      break;
    case "experiment.health.srm":
      detail = `Sample ratio mismatch detected (threshold: ${event.data.object.threshold}).`;
      break;
    case "experiment.health.multipleExposures":
      detail = `${event.data.object.usersCount} users (${(event.data.object.percent * 100).toFixed(2)}%) were exposed to multiple variations.`;
      break;
    case "experiment.metric.guardrailFailure":
      detail = `Failing guardrails: ${event.data.object.failedMetrics.map((m) => `${m.name} (${m.variationName})`).join(", ")}.`;
      break;
    case "experiment.bandit.weightsChanged":
      detail = `Bandit allocation changed from ${event.data.object.currentWeights.map((w) => `${(w * 100).toFixed(1)}%`).join(" / ")} to ${event.data.object.updatedWeights.map((w) => `${(w * 100).toFixed(1)}%`).join(" / ")}.`;
      break;
  }
  const text = `${object.experimentName}: ${detail}`;
  return {
    text,
    blocks: [
      {
        type: "section",
        text: { type: "plain_text", text: text.slice(0, 3000), emoji: false },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "View in GrowthBook" },
            url: `${APP_ORIGIN}/experiment/${encodeURIComponent(object.experimentId)}`,
          },
        ],
      },
    ],
  };
}
