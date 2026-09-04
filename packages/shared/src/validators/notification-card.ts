export const experimentCardFormats = ["none", "compact", "detailed"] as const;

export const notificationCardKinds = [
  "started",
  "significance",
  "won",
  "lost",
  "stopped",
  "warning",
] as const;

export type NotificationCardKind = (typeof notificationCardKinds)[number];

export const NOTIFICATION_CARD_EVENT_KINDS: Record<
  string,
  NotificationCardKind
> = {
  "experiment.info.significance": "significance",
  "experiment.warning": "warning",
};

export const notificationCardKindForEvent = (
  eventName: string,
): NotificationCardKind | undefined => NOTIFICATION_CARD_EVENT_KINDS[eventName];
