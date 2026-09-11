import { z } from "zod";

export const experimentCardFormats = [
  "compact",
  "compact-dark",
  "detailed",
] as const;

export const experimentCardFormatSchema = z.enum(experimentCardFormats);
export type ExperimentCardFormat = z.infer<typeof experimentCardFormatSchema>;

export const notificationSettingsSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text") }).strict(),
  z
    .object({
      type: z.literal("image"),
      cardFormat: experimentCardFormatSchema,
    })
    .strict(),
]);
export type NotificationSettings = z.infer<typeof notificationSettingsSchema>;

export const DEFAULT_NOTIFICATION_SETTINGS = {
  type: "image",
  cardFormat: "compact",
} satisfies NotificationSettings;

export const notificationCardKinds = [
  "started",
  "significance",
  "won",
  "lost",
  "stopped",
  "warning",
] as const;

export type NotificationCardKind = (typeof notificationCardKinds)[number];
