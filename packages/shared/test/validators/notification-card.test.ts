import { slackNotificationPreviewBodySchema } from "../../src/validators/event-webhook";
import { notificationSettingsSchema } from "../../src/validators/notification-card";

describe("notification settings", () => {
  it.each([
    { type: "text" },
    { type: "image", cardFormat: "compact" },
    { type: "image", cardFormat: "compact-dark" },
    { type: "image", cardFormat: "detailed" },
  ])("accepts $type delivery with $cardFormat", (settings) => {
    expect(notificationSettingsSchema.parse(settings)).toEqual(settings);
  });

  it.each([
    { type: "image", cardFormat: "none" },
    { type: "image" },
    { type: "text", cardFormat: "compact" },
    { cardFormat: "compact" },
  ])("rejects inconsistent notification settings %j", (settings) => {
    expect(notificationSettingsSchema.safeParse(settings).success).toBe(false);
  });
});

describe("Slack preview and test requests", () => {
  it.each([
    { type: "text" },
    { type: "image", cardFormat: "compact" },
    { type: "image", cardFormat: "compact-dark" },
    { type: "image", cardFormat: "detailed" },
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
      notificationSettings: { type: "text", cardFormat: "compact" },
    },
    { eventName: "digest:scorecard", notificationSettings: { type: "text" } },
  ])("rejects removed or inconsistent requests %j", (request) => {
    expect(slackNotificationPreviewBodySchema.safeParse(request).success).toBe(
      false,
    );
  });
});
