import { createHmac } from "node:crypto";
import { ReqContext } from "back-end/types/request";
import {
  connectSlackOAuthIntegration,
  getSlackOAuthAuthorizeUrl,
} from "back-end/src/services/slackIntegration";
import { fetch } from "back-end/src/util/http.util";
import { JWT_SECRET } from "back-end/src/util/secrets";

jest.mock("back-end/src/util/http.util", () => ({
  fetch: jest.fn(),
}));

jest.mock("back-end/src/util/secrets", () => ({
  ...jest.requireActual("back-end/src/util/secrets"),
  APP_ORIGIN: "https://growthbook.example",
  JWT_SECRET: "test-jwt-secret",
  SLACK_CLIENT_ID: "slack-client-id",
  SLACK_CLIENT_SECRET: "slack-client-secret",
}));

const context = {
  org: { id: "org-1" },
  userId: "user-1",
} as ReqContext;

const getValidState = () => {
  const state = new URL(getSlackOAuthAuthorizeUrl(context)).searchParams.get(
    "state",
  );
  if (!state) throw new Error("Expected OAuth state");
  return state;
};

describe("Slack OAuth validation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("rejects OAuth state with extra segments", async () => {
    await expect(
      connectSlackOAuthIntegration({
        context,
        code: "code",
        state: "payload.signature.extra",
      }),
    ).rejects.toThrow("Invalid Slack OAuth state");

    expect(fetch).not.toHaveBeenCalled();
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

    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects successful Slack responses without a bot access token", async () => {
    jest.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      statusText: "OK",
      json: async () => ({
        ok: true,
        team: { id: "T123", name: "GrowthBook" },
      }),
    } as unknown as Awaited<ReturnType<typeof fetch>>);

    await expect(
      connectSlackOAuthIntegration({
        context,
        code: "code",
        state: getValidState(),
      }),
    ).rejects.toThrow("Slack returned an invalid OAuth response");
  });
});
