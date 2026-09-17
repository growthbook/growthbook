import { z } from "zod";

export const notificationCardFormats = ["light", "dark"] as const;

// Settings saved before the single card layout named the old variants.
const LEGACY_CARD_FORMATS: Record<
  string,
  (typeof notificationCardFormats)[number]
> = {
  compact: "light",
  detailed: "light",
  "compact-dark": "dark",
};

export const notificationCardFormatSchema = z.preprocess(
  (value) =>
    typeof value === "string" ? (LEGACY_CARD_FORMATS[value] ?? value) : value,
  z.enum(notificationCardFormats),
);
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
