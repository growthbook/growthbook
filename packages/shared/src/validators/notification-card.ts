import { z } from "zod";

export const notificationCardFormats = ["light", "dark"] as const;

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
  cardFormat: "light",
} satisfies NotificationSettings;

// Stored settings as the current schema reads them; unset or unreadable
// values fall back to the default.
export function parseNotificationSettings(
  value: unknown,
): NotificationSettings {
  const parsed = notificationSettingsSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_NOTIFICATION_SETTINGS;
}
