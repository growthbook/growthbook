import { createHmac } from "node:crypto";
import { vi } from "vitest";
import { ReqContext } from "back-end/types/request";
import {
  connectSlackOAuthIntegration,
  getSlackChannelEventWebhookId,
  getSlackOAuthAuthorizeUrl,
} from "back-end/src/services/slackIntegration";
import { cancellableFetch } from "back-end/src/util/http.util";
import { JWT_SECRET } from "back-end/src/util/secrets";

vi.mock("back-end/src/util/http.util", () => ({
  cancellableFetch: vi.fn(),
}));

vi.mock("back-end/src/util/secrets", async () => ({
  ...(await vi.importActual<typeof import("back-end/src/util/secrets")>(
    "back-end/src/util/secrets",
  )),
  APP_ORIGIN: "https://growthbook.example",
  JWT_SECRET: "test-jwt-secret",
  SLACK_CLIENT_ID: "slack-client-id",
  SLACK_CLIENT_SECRET: "slack-client-secret",
}));

const upsertSlackWorkspaceConnection = vi.fn();

const context = {
  org: { id: "org-1" },
  userId: "user-1",
  models: {
    slackWorkspaceConnections: {
      upsertForTeam: upsertSlackWorkspaceConnection,
    },
  },
} as unknown as ReqContext;

const getValidState = () => {
  const state = new URL(getSlackOAuthAuthorizeUrl(context)).searchParams.get(
    "state",
  );
  if (!state) throw new Error("Expected OAuth state");
  return state;
};

describe("Slack OAuth validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects OAuth state with extra segments", async () => {
    await expect(
      connectSlackOAuthIntegration({
        context,
        code: "code",
        state: "payload.signature.extra",
      }),
    ).rejects.toThrow("Invalid Slack OAuth state");

    expect(cancellableFetch).not.toHaveBeenCalled();
  });

  it("rejects a signed state containing malformed JSON", async () => {
    const payload = Buffer.from("{not-json").toString("base64url");
    const signature = createHmac("sha256", JWT_SECRET)
      .update(payload)
      .digest("base64url");

    await expect(
      connectSlackOAuthIntegration({
        context,
        code: "code",
        state: `${payload}.${signature}`,
      }),
    ).rejects.toThrow("Invalid Slack OAuth state");

    expect(cancellableFetch).not.toHaveBeenCalled();
  });

  it("rejects successful Slack responses without a bot access token", async () => {
    vi.mocked(cancellableFetch).mockResolvedValueOnce({
      responseWithoutBody: { ok: true, statusText: "OK" },
      stringBody: JSON.stringify({
        ok: true,
        team: { id: "T123", name: "GrowthBook" },
      }),
    } as unknown as Awaited<ReturnType<typeof cancellableFetch>>);

    await expect(
      connectSlackOAuthIntegration({
        context,
        code: "code",
        state: getValidState(),
      }),
    ).rejects.toThrow("Slack returned an invalid OAuth response");
  });

  it("bounds OAuth requests through the proxy-aware HTTP helper", async () => {
    vi.mocked(cancellableFetch).mockRejectedValueOnce(
      new Error("request aborted"),
    );
    await expect(
      connectSlackOAuthIntegration({
        context,
        code: "code",
        state: getValidState(),
      }),
    ).rejects.toThrow("request aborted");
    expect(upsertSlackWorkspaceConnection).not.toHaveBeenCalled();
    expect(cancellableFetch).toHaveBeenCalledWith(
      "https://slack.com/api/oauth.v2.access",
      expect.objectContaining({
        method: "POST",
        body: "code=code&redirect_uri=https%3A%2F%2Fgrowthbook.example%2Fintegrations%2Fslack",
      }),
      { maxTimeMs: 15000, maxContentSize: 1024 * 256 },
    );
  });

  it.each([
    "",
    "not json",
    JSON.stringify({
      ok: true,
      access_token: "xoxb-token",
      padding: "x".repeat(1024 * 256),
    }),
  ])(
    "rejects incomplete, malformed, or oversized exchange responses",
    async (stringBody) => {
      vi.mocked(cancellableFetch).mockResolvedValueOnce({
        responseWithoutBody: { ok: true },
        stringBody,
      } as never);
      await expect(
        connectSlackOAuthIntegration({
          context,
          code: "code",
          state: getValidState(),
        }),
      ).rejects.toThrow("Slack returned an invalid OAuth response");
      expect(upsertSlackWorkspaceConnection).not.toHaveBeenCalled();
    },
  );

  it("stores workspace credentials outside EventWebHooks", async () => {
    const dateCreated = new Date("2026-09-03T12:00:00Z");
    const dateUpdated = new Date("2026-09-03T12:00:00Z");
    vi.mocked(cancellableFetch).mockResolvedValueOnce({
      responseWithoutBody: { ok: true, statusText: "OK" },
      stringBody: JSON.stringify({
        ok: true,
        app_id: "A123",
        access_token: "xoxb-secret",
        scope: "chat:write",
        team: { id: "T123", name: "GrowthBook" },
      }),
    } as unknown as Awaited<ReturnType<typeof cancellableFetch>>);
    upsertSlackWorkspaceConnection.mockResolvedValueOnce({
      organization: "org-1",
      teamId: "T123",
      teamName: "GrowthBook",
      appId: "A123",
      encryptedBotAccessToken: "encrypted:v1:ciphertext",
      scope: "chat:write",
      dateCreated,
      dateUpdated,
    });

    await expect(
      connectSlackOAuthIntegration({
        context,
        code: "code",
        state: getValidState(),
      }),
    ).resolves.toEqual({
      slackConnection: {
        teamId: "T123",
        teamName: "GrowthBook",
        appId: "A123",
        scope: "chat:write",
        dateCreated,
        dateUpdated,
      },
      slackIntegration: null,
    });

    expect(upsertSlackWorkspaceConnection).toHaveBeenCalledWith(
      "T123",
      expect.objectContaining({
        encryptedBotAccessToken: expect.stringMatching(/^encrypted:v1:/),
      }),
    );
    expect(upsertSlackWorkspaceConnection).not.toHaveBeenCalledWith(
      "T123",
      expect.objectContaining({
        encryptedBotAccessToken: expect.stringContaining("xoxb-secret"),
      }),
    );
  });
});

describe("Slack channel webhook ids", () => {
  it("is deterministic and scoped to the organization, workspace, and channel", () => {
    const first = getSlackChannelEventWebhookId({
      organizationId: "org-1",
      teamId: "T123",
      channelId: "C123",
    });

    expect(
      getSlackChannelEventWebhookId({
        organizationId: "org-1",
        teamId: "T123",
        channelId: "C123",
      }),
    ).toBe(first);
    expect(
      getSlackChannelEventWebhookId({
        organizationId: "org-2",
        teamId: "T123",
        channelId: "C123",
      }),
    ).not.toBe(first);
    expect(
      getSlackChannelEventWebhookId({
        organizationId: "org-1",
        teamId: "T123",
        channelId: "C456",
      }),
    ).not.toBe(first);
  });
});
