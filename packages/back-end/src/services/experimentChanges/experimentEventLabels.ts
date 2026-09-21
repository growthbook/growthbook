import type {
  ExperimentInfoScheduledStatusUpdatePayload,
  ExperimentWarningNotificationPayload,
} from "shared/validators";

// Every experiment event's headline, shared by the card banner and the text
// message title so the two channels cannot drift. Sets keyed by a payload
// discriminator are typed against it, so a new variant must name itself.

export const EXPERIMENT_EVENT_LABELS = {
  created: "Experiment Created",
  updated: "Experiment Updated",
  deleted: "Experiment Deleted",
  started: "Experiment Started",
  // The stop headline appends the result; see getExperimentStoppedLabel.
  stopped: "Experiment Stopped",
  endingSoon: "Ending Soon",
  stale: "Stale",
  guardrailFailed: "Guardrail Failed",
  banditWeightsChanged: "Bandit Weights Changed",
  significance: "Significance Reached",
} as const;

export const EXPERIMENT_WARNING_LABELS: Record<
  ExperimentWarningNotificationPayload["type"],
  string
> = {
  srm: "Health Alert - SRM Detected",
  "multiple-exposures": "Health Alert - Multiple Exposures",
  "no-data": "Health Alert - No Data",
  underpowered: "Health Alert - Underpowered",
  "auto-update": "Automatic Updates",
  "update-failed": "Update Failed",
  "scheduled-status-update-failed": "Scheduled Update Failed",
};

export type ExperimentDecision = "ship" | "rollback" | "review";

export const EXPERIMENT_DECISION_LABELS: Record<ExperimentDecision, string> = {
  ship: "Ship Now",
  rollback: "Roll Back Now",
  review: "Ready for Review",
};

export const SCHEDULED_STATUS_UPDATE_LABELS: Record<
  ExperimentInfoScheduledStatusUpdatePayload["action"],
  string
> = {
  started: "Started as Scheduled",
  stopped: "Stopped as Scheduled",
  "kept-running": "Kept Running Past Schedule",
};
