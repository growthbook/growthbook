import {
  DEFAULT_NOTIFICATION_SETTINGS,
  notificationSettingsSchema,
  parseNotificationSettings,
} from "../../src/validators/notification-card";

describe("notification settings", () => {
  it.each([
    { type: "text" },
    { type: "image", cardFormat: "light" },
    { type: "image", cardFormat: "dark" },
  ])("accepts $type delivery with $cardFormat", (settings) => {
    expect(notificationSettingsSchema.parse(settings)).toEqual(settings);
  });

  it.each([
    ["compact", "light"],
    ["detailed", "light"],
    ["compact-dark", "dark"],
  ])("reads the legacy %s format as %s", (legacy, format) => {
    expect(
      notificationSettingsSchema.parse({ type: "image", cardFormat: legacy }),
    ).toEqual({ type: "image", cardFormat: format });
  });

  it.each([
    { type: "image", cardFormat: "none" },
    { type: "image" },
    { type: "text", cardFormat: "light" },
    { cardFormat: "light" },
  ])("rejects inconsistent notification settings %j", (settings) => {
    expect(notificationSettingsSchema.safeParse(settings).success).toBe(false);
  });

  it("falls back to the default for unset or unreadable stored settings", () => {
    expect(parseNotificationSettings(undefined)).toEqual(
      DEFAULT_NOTIFICATION_SETTINGS,
    );
    expect(
      parseNotificationSettings({ type: "image", cardFormat: "x" }),
    ).toEqual(DEFAULT_NOTIFICATION_SETTINGS);
    expect(parseNotificationSettings({ type: "text" })).toEqual({
      type: "text",
    });
  });
});
