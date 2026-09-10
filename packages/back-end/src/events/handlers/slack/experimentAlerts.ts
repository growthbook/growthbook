import type { NotificationEvent } from "shared/types/events/notification-events";
import { APP_ORIGIN } from "back-end/src/util/secrets";
import type { SlackMessage } from "./slack-event-handler-utils";

type AlertName =
  | "experiment.started"
  | "experiment.stopped"
  | "experiment.health.guardrailFailed"
  | "experiment.health.queryFailed"
  | "experiment.status.changed"
  | "experiment.endingSoon"
  | "experiment.stale"
  | "experiment.metric.regression"
  | "experiment.bandit.weightsChanged"
  | "experiment.holdout.created"
  | "experiment.holdout.updated";

type AlertEvent = Extract<NotificationEvent, { event: AlertName }>;

export function buildExperimentAlertMessage(event: AlertEvent): SlackMessage {
  const object = event.data.object;
  let detail: string;
  switch (event.event) {
    case "experiment.started":
      detail = `Started with ${event.data.object.variationCount} variations.`;
      break;
    case "experiment.stopped": {
      const data = event.data.object;
      detail = `Stopped. Result: ${data.results}.`;
      if (data.enableTemporaryRollout && data.releasedVariationName) {
        detail += ` Temporary rollout: ${data.releasedVariationName}.`;
      }
      if (data.reason) detail += ` ${data.reason}`;
      break;
    }
    case "experiment.health.guardrailFailed":
      detail = `Failing guardrails: ${event.data.object.failedMetrics.map((m) => `${m.name} (${m.variationName})`).join(", ")}.`;
      break;
    case "experiment.health.queryFailed":
      detail = "The results query failed. Open GrowthBook for details.";
      break;
    case "experiment.status.changed":
      detail = `Status changed from ${event.data.object.previousStatus} to ${event.data.object.currentStatus}.`;
      break;
    case "experiment.endingSoon":
      detail = `Scheduled to end at ${event.data.object.endsAt}.`;
      break;
    case "experiment.stale":
      detail = `Running for ${event.data.object.daysRunning} days. Review whether to stop or extend it.`;
      break;
    case "experiment.metric.regression":
      detail = `Regression detected for ${event.data.object.metricName} (${event.data.object.variationName}).`;
      break;
    case "experiment.bandit.weightsChanged":
      detail = `Bandit allocation changed from ${event.data.object.currentWeights.map((w) => `${(w * 100).toFixed(1)}%`).join(" / ")} to ${event.data.object.updatedWeights.map((w) => `${(w * 100).toFixed(1)}%`).join(" / ")}.`;
      break;
    case "experiment.holdout.created":
      detail = "Holdout created.";
      break;
    case "experiment.holdout.updated":
      detail = "Holdout updated.";
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
