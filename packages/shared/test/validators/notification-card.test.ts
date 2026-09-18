import { slackNotificationPreviewBodySchema } from "../../src/validators/event-webhook";
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

describe("Slack preview and test requests", () => {
  it.each([
    { type: "text" },
    { type: "image", cardFormat: "light" },
    { type: "image", cardFormat: "dark" },
  ])("uses notification settings for %j", (notificationSettings) => {
    const request = { eventName: "experiment.warning", notificationSettings };
    expect(slackNotificationPreviewBodySchema.parse(request)).toEqual(request);
  });
  it.each([
    { eventName: "experiment.warning", format: "none" },
    {
      eventName: "experiment.warning",
      notificationSettings: { type: "image" },
    },
    {
      eventName: "experiment.warning",
      notificationSettings: { type: "text", cardFormat: "light" },
    },
    { eventName: "digest:scorecard", notificationSettings: { type: "text" } },
  ])("rejects removed or inconsistent requests %j", (request) => {
    expect(slackNotificationPreviewBodySchema.safeParse(request).success).toBe(
      false,
    );
  });
});
