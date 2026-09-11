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
