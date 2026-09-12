import { z } from "zod";

export const notificationCardFormats = [
  "compact",
  "compact-dark",
  "detailed",
] as const;

export const notificationCardFormatSchema = z.enum(notificationCardFormats);
export type NotificationCardFormat = z.infer<
  typeof notificationCardFormatSchema
>;

export const notificationSettingsSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text") }).strict(),
  z
    .object({
      type: z.literal("image"),
      cardFormat: notificationCardFormatSchema,
    })
    .strict(),
]);
export type NotificationSettings = z.infer<typeof notificationSettingsSchema>;

export const DEFAULT_NOTIFICATION_SETTINGS = {
  type: "image",
  cardFormat: "compact",
} satisfies NotificationSettings;
