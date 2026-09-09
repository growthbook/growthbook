import { isSlackIncomingWebhookUrl } from "back-end/src/services/slack/slackWebApi";

describe("isSlackIncomingWebhookUrl", () => {
  it("accepts real Slack incoming-webhook URLs", () => {
    expect(
      isSlackIncomingWebhookUrl(
        "https://hooks.slack.com/services/T000/B000/xyz",
      ),
    ).toBe(true);
  });

  it("rejects the workspace-install placeholder url", () => {
    expect(isSlackIncomingWebhookUrl("https://slack.com")).toBe(false);
  });

  it("rejects empty / missing urls", () => {
    expect(isSlackIncomingWebhookUrl("")).toBe(false);
    expect(isSlackIncomingWebhookUrl(undefined)).toBe(false);
    expect(isSlackIncomingWebhookUrl(null)).toBe(false);
  });

  it("rejects lookalike hosts", () => {
    expect(
      isSlackIncomingWebhookUrl("https://hooks.slack.com.evil.com/services/x"),
    ).toBe(false);
    expect(isSlackIncomingWebhookUrl("http://hooks.slack.com/services/x")).toBe(
      false,
    );
  });
});
