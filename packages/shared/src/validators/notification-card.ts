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
