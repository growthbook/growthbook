import {
  parseGrowthBookExperimentUrl,
  escapeSlackMrkdwnText,
  handleSlackLinkShared,
} from "back-end/src/services/slack/slackUnfurl";
import { resolveSlackAssistantTarget } from "back-end/src/services/slack/slackIdentity";
import { unfurlSlackLinks } from "back-end/src/services/slack/slackWebApi";

jest.mock("back-end/src/util/secrets", () => ({
  APP_ORIGIN: "https://app.growthbook.io",
}));
jest.mock("back-end/src/services/slack/slackIdentity", () => ({
  resolveSlackAssistantTarget: jest.fn(),
}));
jest.mock("back-end/src/services/notificationCards/experimentCardData", () => ({
  buildExperimentCardData: jest.fn(),
}));
jest.mock("back-end/src/services/slack/slackWebApi", () => ({
  unfurlSlackLinks: jest.fn(),
}));

const event = {
  teamId: "T1",
  channelId: "C1",
  messageTs: "123.456",
  slackUserId: "U1",
  links: [{ url: "https://app.growthbook.io/experiment/exp_123" }],
};
beforeEach(() => jest.clearAllMocks());

describe("Slack experiment link previews", () => {
  it("accepts only experiment URLs on this installation", () => {
    expect(
      parseGrowthBookExperimentUrl(
        "https://app.growthbook.io/experiment/exp_123#results",
      ),
    ).toBe("exp_123");
    for (const url of [
      "https://evil.example/experiment/exp_123",
      "https://app.growthbook.io.evil.example/experiment/exp_123",
      "http://app.growthbook.io/experiment/exp_123",
      "https://app.growthbook.io:444/experiment/exp_123",
      "https://app.growthbook.io/experiment/exp_123/private",
      "not a URL",
    ]) {
      expect(parseGrowthBookExperimentUrl(url)).toBeUndefined();
    }
  });
  it("escapes Slack mention and link syntax in customer names", () => {
    expect(
      escapeSlackMrkdwnText("<!channel> <https://evil.example|click> &"),
    ).toBe("&lt;!channel&gt; &lt;https://evil.example|click&gt; &amp;");
  });
  it("does not post previews for unlinked users", async () => {
    jest.mocked(resolveSlackAssistantTarget).mockResolvedValue({
      ok: false,
      reason: "not_linked",
      message: "Link your account",
    });
    await handleSlackLinkShared(event);
    expect(unfurlSlackLinks).not.toHaveBeenCalled();
  });
  it("ignores external URLs before resolving account access", async () => {
    await handleSlackLinkShared({
      ...event,
      links: [{ url: "https://evil.example/experiment/exp_123" }],
    });
    expect(resolveSlackAssistantTarget).not.toHaveBeenCalled();
    expect(unfurlSlackLinks).not.toHaveBeenCalled();
  });
});
