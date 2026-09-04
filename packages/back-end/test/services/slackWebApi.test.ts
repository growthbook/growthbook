import {
  isSlackWorkspacePlaceholderUrl,
  joinSlackConversation,
  listSlackConversations,
  postSlackMessageResult,
} from "back-end/src/services/slack/slackWebApi";
import { cancellableFetch } from "back-end/src/util/http.util";

jest.mock("back-end/src/util/http.util", () => ({
  cancellableFetch: jest.fn(),
}));

const slackResponse = (body: Record<string, unknown>) => ({
  responseWithoutBody: { ok: true, status: 200 },
  stringBody: JSON.stringify(body),
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe("isSlackWorkspacePlaceholderUrl", () => {
  it("accepts the workspace placeholder with or without a trailing slash", () => {
    expect(isSlackWorkspacePlaceholderUrl("https://slack.com")).toBe(true);
    expect(isSlackWorkspacePlaceholderUrl("https://slack.com/")).toBe(true);
  });

  it("rejects real webhook and custom relay urls", () => {
    expect(
      isSlackWorkspacePlaceholderUrl(
        "https://hooks.slack.com/services/T000/B000/xyz",
      ),
    ).toBe(false);
    expect(
      isSlackWorkspacePlaceholderUrl("https://relay.example.com/slack"),
    ).toBe(false);
  });
});

describe("Slack Web API", () => {
  it("posts text and blocks with the bot token", async () => {
    cancellableFetch.mockResolvedValueOnce(
      slackResponse({ ok: true, ts: "123.456" }),
    );
    const blocks = [
      {
        type: "section",
        text: { type: "mrkdwn", text: "Open <https://example.com|GrowthBook>" },
      },
    ];

    await expect(
      postSlackMessageResult({
        token: "xoxb-token",
        channel: "C123",
        text: "Hello",
        blocks,
      }),
    ).resolves.toEqual({ ok: true, ts: "123.456", error: null });

    expect(cancellableFetch).toHaveBeenCalledWith(
      "https://slack.com/api/chat.postMessage",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer xoxb-token",
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({ channel: "C123", text: "Hello", blocks }),
      },
      { maxTimeMs: 15000, maxContentSize: 1024 * 256 },
    );
  });

  it("lists normalized, active conversations", async () => {
    cancellableFetch.mockResolvedValueOnce(
      slackResponse({
        ok: true,
        channels: [
          {
            id: "C123",
            name: "alerts",
            is_private: false,
            is_member: true,
          },
          { id: "C999", name: "archived", is_archived: true },
        ],
        response_metadata: { next_cursor: "next" },
      }),
    );

    await expect(
      listSlackConversations({ token: "xoxb-token" }),
    ).resolves.toEqual({
      channels: [
        {
          id: "C123",
          name: "alerts",
          isPrivate: false,
          isMember: true,
        },
      ],
      nextCursor: "next",
    });
  });

  it("surfaces logical Slack API errors when joining", async () => {
    cancellableFetch.mockResolvedValueOnce(
      slackResponse({ ok: false, error: "method_not_supported" }),
    );

    await expect(
      joinSlackConversation({ token: "xoxb-token", channelId: "C123" }),
    ).resolves.toEqual({ ok: false, error: "method_not_supported" });
  });
});
