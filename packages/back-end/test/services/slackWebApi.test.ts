import {
  getSlackConversation,
  isSlackWorkspacePlaceholderUrl,
  joinSlackConversation,
  listSlackConversations,
  postSlackMessageResult,
  uploadSlackImageFile,
  updateSlackMessage,
  SlackRateLimitError,
} from "back-end/src/services/slack/slackWebApi";
import { cancellableFetch, fetch } from "back-end/src/util/http.util";

jest.mock("back-end/src/util/http.util", () => ({
  cancellableFetch: jest.fn(),
  fetch: jest.fn(),
}));

const slackResponse = (body: Record<string, unknown>) => ({
  responseWithoutBody: { ok: true, status: 200 },
  stringBody: JSON.stringify(body),
});

const rateLimitedResponse = (retryAfter: string | null) => ({
  responseWithoutBody: {
    ok: false,
    status: 429,
    headers: { get: () => retryAfter },
  },
  stringBody: JSON.stringify({ ok: false, error: "ratelimited" }),
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

  it("uploads a notification card and shares it with the footer blocks", async () => {
    cancellableFetch
      .mockResolvedValueOnce(
        slackResponse({
          ok: true,
          upload_url: "https://files.slack.test/upload",
          file_id: "F123",
        }),
      )
      .mockResolvedValueOnce(slackResponse({ ok: true }));
    fetch.mockResolvedValueOnce({ ok: true, status: 200 });

    const png = Buffer.from("png");
    const blocks = [
      { type: "context", elements: [{ type: "mrkdwn", text: "footer" }] },
    ];
    await expect(
      uploadSlackImageFile({
        token: "xoxb-token",
        png,
        filename: "experiment-card.png",
        title: "Experiment stopped",
        channelId: "C123",
        blocks,
        initialComment: "footer",
      }),
    ).resolves.toBe("F123");

    expect(fetch).toHaveBeenCalledWith("https://files.slack.test/upload", {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: png,
      signal: expect.any(AbortSignal),
    });
    // Shared on upload so the channel can see it, with the blocks as the
    // share message; Slack takes them as a JSON string.
    expect(cancellableFetch).toHaveBeenLastCalledWith(
      "https://slack.com/api/files.completeUploadExternal",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          files: [{ id: "F123", title: "Experiment stopped" }],
          channel_id: "C123",
          blocks: JSON.stringify(blocks),
        }),
      }),
      { maxTimeMs: 15000, maxContentSize: 1024 * 256 },
    );
  });

  it("falls back to a plain comment when Slack rejects the footer blocks", async () => {
    cancellableFetch
      .mockResolvedValueOnce(
        slackResponse({
          ok: true,
          upload_url: "https://files.slack.test/upload",
          file_id: "F123",
        }),
      )
      .mockResolvedValueOnce(
        slackResponse({ ok: false, error: "invalid_blocks" }),
      )
      .mockResolvedValueOnce(slackResponse({ ok: true }));
    fetch.mockResolvedValueOnce({ ok: true, status: 200 });

    await expect(
      uploadSlackImageFile({
        token: "xoxb-token",
        png: Buffer.from("png"),
        filename: "experiment-card.png",
        channelId: "C123",
        blocks: [{ type: "context", elements: [] }],
        initialComment: "footer",
      }),
    ).resolves.toBe("F123");

    expect(cancellableFetch).toHaveBeenLastCalledWith(
      "https://slack.com/api/files.completeUploadExternal",
      expect.objectContaining({
        body: JSON.stringify({
          files: [{ id: "F123", title: "experiment-card.png" }],
          channel_id: "C123",
          initial_comment: "footer",
        }),
      }),
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

describe("Slack conversation details", () => {
  it.each([true, false])(
    "accepts info responses without membership (private: %s)",
    async (isPrivate) => {
      cancellableFetch.mockResolvedValueOnce(
        slackResponse({
          ok: true,
          channel: {
            id: "C1",
            name: "alerts",
            is_private: isPrivate,
            is_archived: false,
          },
        }),
      );
      await expect(
        getSlackConversation({ token: "xoxb-token", channelId: "C1" }),
      ).resolves.toEqual({
        id: "C1",
        name: "alerts",
        isPrivate,
        isMember: isPrivate,
      });
    },
  );

  it("preserves private-channel membership", async () => {
    cancellableFetch.mockResolvedValueOnce(
      slackResponse({
        ok: true,
        channel: {
          id: "C1",
          name: "private-alerts",
          is_private: true,
          is_member: true,
          is_archived: false,
        },
      }),
    );
    await expect(
      getSlackConversation({ token: "xoxb-token", channelId: "C1" }),
    ).resolves.toEqual({
      id: "C1",
      name: "private-alerts",
      isPrivate: true,
      isMember: true,
    });
  });
  it.each([
    {
      id: "C1",
      name: "archived",
      is_private: false,
      is_member: true,
      is_archived: true,
    },
    { id: "C1", name: "missing-membership" },
    {
      id: "C2",
      name: "wrong-channel",
      is_private: false,
      is_member: true,
      is_archived: false,
    },
  ])("rejects archived or incomplete channel details", async (channel) => {
    cancellableFetch.mockResolvedValueOnce(
      slackResponse({ ok: true, channel }),
    );
    await expect(
      getSlackConversation({ token: "xoxb-token", channelId: "C1" }),
    ).resolves.toBeNull();
  });
});

describe("Slack rate limits", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    cancellableFetch.mockReset();
  });

  afterEach(() => {
    cancellableFetch.mockReset();
    jest.useRealTimers();
  });

  it("waits for Retry-After before retrying the same message", async () => {
    cancellableFetch
      .mockResolvedValueOnce(rateLimitedResponse("2"))
      .mockResolvedValueOnce(slackResponse({ ok: true, ts: "123.456" }));

    const result = postSlackMessageResult({
      token: "xoxb-token",
      channel: "C123",
      text: "Answer",
    });
    await jest.advanceTimersByTimeAsync(1999);
    expect(cancellableFetch).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(cancellableFetch).toHaveBeenCalledTimes(2);
    expect(cancellableFetch.mock.calls[1]).toEqual(
      cancellableFetch.mock.calls[0],
    );
    await expect(result).resolves.toEqual({
      ok: true,
      ts: "123.456",
      error: null,
    });
  });

  it("retries message updates without posting another message", async () => {
    cancellableFetch
      .mockResolvedValueOnce(rateLimitedResponse("1"))
      .mockResolvedValueOnce(slackResponse({ ok: true }));
    const result = updateSlackMessage({
      token: "xoxb-token",
      channel: "C123",
      ts: "123.456",
      text: "Answer",
    });
    await jest.advanceTimersByTimeAsync(1000);
    await expect(result).resolves.toBe(true);
    expect(cancellableFetch).toHaveBeenCalledTimes(2);
    expect(cancellableFetch.mock.calls[1]).toEqual(
      cancellableFetch.mock.calls[0],
    );
    expect(cancellableFetch.mock.calls[1][0]).toBe(
      "https://slack.com/api/chat.update",
    );
  });

  it("also honors Retry-After on GET requests", async () => {
    cancellableFetch
      .mockResolvedValueOnce(rateLimitedResponse("2"))
      .mockResolvedValueOnce(slackResponse({ ok: true, channels: [] }));
    const result = listSlackConversations({ token: "xoxb-token" });
    await jest.advanceTimersByTimeAsync(1999);
    expect(cancellableFetch).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toEqual({ channels: [], nextCursor: null });
    expect(cancellableFetch).toHaveBeenCalledTimes(2);
    expect(cancellableFetch.mock.calls[1]).toEqual(
      cancellableFetch.mock.calls[0],
    );
  });

  it("fails explicitly after three rate-limit retries", async () => {
    cancellableFetch.mockResolvedValue(rateLimitedResponse("1"));
    const result = expect(
      postSlackMessageResult({ token: "token", channel: "C1", text: "Answer" }),
    ).rejects.toThrow(SlackRateLimitError);
    await jest.runAllTimersAsync();
    await result;
    expect(cancellableFetch).toHaveBeenCalledTimes(4);
    expect(jest.getTimerCount()).toBe(0);
  });

  it("caps total waiting without shortening the next cooldown", async () => {
    cancellableFetch.mockResolvedValue(rateLimitedResponse("40"));
    const startedAt = Date.now();
    const result = expect(
      postSlackMessageResult({ token: "token", channel: "C1", text: "Answer" }),
    ).rejects.toThrow(SlackRateLimitError);
    await jest.runAllTimersAsync();
    await result;
    expect(cancellableFetch).toHaveBeenCalledTimes(2);
    expect(Date.now() - startedAt).toBe(40_000);
  });

  it("does not retry early when Retry-After exceeds the wait budget", async () => {
    cancellableFetch.mockResolvedValue(rateLimitedResponse("61"));
    await expect(
      postSlackMessageResult({ token: "token", channel: "C1", text: "Answer" }),
    ).rejects.toThrow(SlackRateLimitError);
    expect(cancellableFetch).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it("allows a successful retry at the total wait limit", async () => {
    cancellableFetch
      .mockResolvedValueOnce(rateLimitedResponse("30"))
      .mockResolvedValueOnce(rateLimitedResponse("30"))
      .mockResolvedValueOnce(slackResponse({ ok: true, ts: "123.456" }));
    const result = postSlackMessageResult({
      token: "token",
      channel: "C1",
      text: "Answer",
    });
    await jest.advanceTimersByTimeAsync(60_000);
    await expect(result).resolves.toMatchObject({ ok: true, ts: "123.456" });
    expect(cancellableFetch).toHaveBeenCalledTimes(3);
  });

  it.each([null, "", "invalid", "-2", "Infinity", "0"])(
    "backs off when Retry-After is missing or unusable: %p",
    async (retryAfter) => {
      cancellableFetch
        .mockResolvedValueOnce(rateLimitedResponse(retryAfter))
        .mockResolvedValueOnce(slackResponse({ ok: true, ts: "123.456" }));
      const result = postSlackMessageResult({
        token: "token",
        channel: "C1",
        text: "Answer",
      });
      await jest.advanceTimersByTimeAsync(999);
      expect(cancellableFetch).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(1);
      await expect(result).resolves.toMatchObject({ ok: true });
      expect(cancellableFetch).toHaveBeenCalledTimes(2);
    },
  );

  it("does not replay a POST with an uncertain network outcome", async () => {
    cancellableFetch.mockRejectedValueOnce(new Error("Connection lost"));
    await expect(
      postSlackMessageResult({ token: "token", channel: "C1", text: "Answer" }),
    ).resolves.toMatchObject({ ok: false });
    expect(cancellableFetch).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it("does not retry other HTTP errors", async () => {
    cancellableFetch.mockResolvedValue({
      responseWithoutBody: { ok: false, status: 500 },
      stringBody: "Internal error",
    });
    await expect(
      postSlackMessageResult({ token: "token", channel: "C1", text: "Answer" }),
    ).resolves.toMatchObject({ ok: false });
    expect(cancellableFetch).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });
});
