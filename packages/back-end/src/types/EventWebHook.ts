export const eventWebHookPayloadTypes = [
  "raw",
  "slack",
  "discord",
] as const;

export type EventWebHookPayloadType = typeof eventWebHookPayloadTypes[number];

export const eventWebHookMethods = ["POST", "PUT", "PATCH"] as const;

export type EventWebHookMethod = typeof eventWebHookMethods[number];
