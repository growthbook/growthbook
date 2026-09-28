import type { NotificationEvent } from "shared/types/events/notification-events";
import { EXPERIMENT_EVENT_LABELS } from "back-end/src/services/experimentChanges/experimentEventLabels";
import { getExperimentStartedFields } from "back-end/src/services/experimentChanges/experimentStartedSummary";
import {
  getExperimentStoppedLabel,
  getExperimentStoppedTextFields,
} from "back-end/src/services/experimentChanges/experimentStoppedSummary";
import { escapeInlineMarkdown } from "back-end/src/services/notificationCards/markdown";
import type { AlertField } from "./alertMessage";
import {
  type ExperimentRun,
  buildExperimentAlertMessage,
} from "./experimentAlertMessage";
import type { SlackMessage } from "./slack-event-handler-utils";

type AlertName =
  | "experiment.status.started"
  | "experiment.status.stopped"
  | "experiment.status.endingSoon"
  | "experiment.status.stale"
  | "experiment.guardrailFailed"
  | "experiment.bandit.weightsChanged";

type AlertEvent = Extract<NotificationEvent, { event: AlertName }>;

const percent = (w: number) => `${(w * 100).toFixed(1)}%`;

// One message shape for the lifecycle alerts; each event supplies its label,
// fields, and whatever of the run it recorded.
export function buildExperimentAlertMessageForEvent(
  event: AlertEvent,
): SlackMessage {
  const object = event.data.object;
  let label: string;
  let fields: AlertField[];
  let run: ExperimentRun = {};
  switch (event.event) {
    case "experiment.status.started":
      label = EXPERIMENT_EVENT_LABELS.started;
      fields = getExperimentStartedFields(event.data.object);
      break;
    case "experiment.status.stopped": {
      const { durationDays, totalUsers } = event.data.object;
      label = getExperimentStoppedLabel(event.data.object);
      fields = getExperimentStoppedTextFields(event.data.object);
      run = { durationDays, units: totalUsers };
      break;
    }
    case "experiment.status.endingSoon": {
      const { durationDays, totalUsers } = event.data.object;
      label = EXPERIMENT_EVENT_LABELS.endingSoon;
      fields = [
        {
          label: "Scheduled end",
          value: escapeInlineMarkdown(event.data.object.endsAt),
        },
      ];
      run = { durationDays, units: totalUsers };
      break;
    }
    case "experiment.status.stale": {
      const { daysRunning, totalUsers } = event.data.object;
      label = EXPERIMENT_EVENT_LABELS.stale;
      fields = [
        {
          label: "Next step",
          value: "Review whether to ship, roll back, or extend it.",
        },
      ];
      // The footer carries the duration, so the field needn't repeat it.
      run = { durationDays: daysRunning, units: totalUsers };
      break;
    }
    case "experiment.guardrailFailed":
      label = EXPERIMENT_EVENT_LABELS.guardrailFailed;
      fields = [
        {
          label: "Failing guardrails",
          value: event.data.object.failedMetrics
            .map(
              (m) =>
                `${escapeInlineMarkdown(m.name)} (${escapeInlineMarkdown(m.variationName)})`,
            )
            .join(", "),
        },
      ];
      break;
    case "experiment.bandit.weightsChanged":
      label = EXPERIMENT_EVENT_LABELS.banditWeightsChanged;
      fields = [
        {
          label: "Allocation",
          value: `${event.data.object.currentWeights.map(percent).join(" / ")} → ${event.data.object.updatedWeights.map(percent).join(" / ")}`,
        },
      ];
      break;
  }
  return buildExperimentAlertMessage({
    experiment: {
      id: object.experimentId,
      name: object.experimentName,
      ownerEmail: object.ownerEmail,
    },
    label,
    fields,
    ...run,
  });
}
