export const experimentCardFormats = ["none", "compact", "detailed"] as const;

export const notificationCardKinds = [
  "started",
  "significance",
  "won",
  "lost",
  "stopped",
  "warning",
  "decisionShip",
  "decisionRollback",
] as const;

export type NotificationCardKind = (typeof notificationCardKinds)[number];

// Stopped events resolve to won/lost/stopped from experiment results at render time.
export const NOTIFICATION_CARD_EVENT_KINDS: Record<
  string,
  NotificationCardKind
> = {
  "experiment.started": "started",
  "experiment.info.significance": "significance",
  "experiment.decision.ship": "decisionShip",
  "experiment.decision.rollback": "decisionRollback",
  "experiment.warning": "warning",
  "experiment.health.guardrailFailed": "warning",
  "experiment.health.noData": "warning",
  "experiment.health.queryFailed": "warning",
  "experiment.stopped.shipped": "stopped",
  "experiment.stopped.rolledback": "stopped",
};

export const notificationCardKindForEvent = (
  eventName: string,
): NotificationCardKind | undefined => NOTIFICATION_CARD_EVENT_KINDS[eventName];
