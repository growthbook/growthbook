import type { NotificationEvent } from "shared/types/events/notification-events";
import { getExperimentStartedText } from "back-end/src/services/experimentChanges/experimentStartedSummary";
import { getExperimentStoppedText } from "back-end/src/services/experimentChanges/experimentStoppedSummary";
import { getExperimentUrl } from "back-end/src/util/appUrls";
import { buildAlertMessage } from "./alertMessage";
import type { SlackMessage } from "./slack-event-handler-utils";

type AlertName =
  | "experiment.status.started"
  | "experiment.status.stopped"
  | "experiment.status.endingSoon"
  | "experiment.status.stale"
  | "experiment.guardrailFailed"
  | "experiment.bandit.weightsChanged";

type AlertEvent = Extract<NotificationEvent, { event: AlertName }>;

export function buildExperimentAlertMessage(event: AlertEvent): SlackMessage {
  const object = event.data.object;
  let detail: string;
  switch (event.event) {
    case "experiment.status.started":
      detail = getExperimentStartedText(event.data.object);
      break;
    case "experiment.status.stopped":
      detail = getExperimentStoppedText(event.data.object);
      break;
    case "experiment.status.endingSoon":
      detail = `Scheduled to end soon at ${event.data.object.endsAt}.`;
      break;
    case "experiment.status.stale":
      detail = `Running for ${event.data.object.daysRunning} days. Review whether to stop or extend it.`;
      break;
    case "experiment.guardrailFailed":
      detail = `Failing guardrails: ${event.data.object.failedMetrics.map((m) => `${m.name} (${m.variationName})`).join(", ")}.`;
      break;
    case "experiment.bandit.weightsChanged":
      detail = `Bandit allocation changed from ${event.data.object.currentWeights.map((w) => `${(w * 100).toFixed(1)}%`).join(" / ")} to ${event.data.object.updatedWeights.map((w) => `${(w * 100).toFixed(1)}%`).join(" / ")}.`;
      break;
  }
  return buildAlertMessage({
    name: object.experimentName,
    detail,
    url: getExperimentUrl(object.experimentId),
  });
}
