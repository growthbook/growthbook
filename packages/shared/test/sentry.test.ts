import { scrubSentryEvent } from "../src/sentry";

describe("scrubSentryEvent", () => {
  it("redacts credential headers and keeps the rest", () => {
    const event = scrubSentryEvent({
      request: {
        headers: {
          Authorization: "Bearer secret-api-key",
          cookie: "AUTH_REFRESH_TOKEN=abc123",
          "x-vercel-auth": "vercel-secret",
          "user-agent": "Mozilla/5.0",
          "content-type": "application/json",
        },
      },
    });

    expect(event.request?.headers).toEqual({
      Authorization: "[Redacted]",
      cookie: "[Redacted]",
      "x-vercel-auth": "[Redacted]",
      "user-agent": "Mozilla/5.0",
      "content-type": "application/json",
    });
  });

  it("redacts tokens in URL paths and query strings", () => {
    expect(
      scrubSentryEvent({
        request: { url: "https://api.growthbook.io/auth/reset/rt_abc123" },
      }).request?.url,
    ).toBe("https://api.growthbook.io/auth/reset/[Redacted]");

    expect(
      scrubSentryEvent({ request: { url: "/invite/inv_abc123/role" } }).request
        ?.url,
    ).toBe("/invite/[Redacted]/role");

    expect(
      scrubSentryEvent({
        request: { url: "/reset-password?foo=1&token=rt_abc123#x" },
      }).request?.url,
    ).toBe("/reset-password?foo=1&token=[Redacted]#x");
  });

  it("redacts OAuth codes and tokens, including in the fragment", () => {
    expect(
      scrubSentryEvent({
        request: { url: "/auth/callback?code=oauth_abc&state=xyz" },
      }).request?.url,
    ).toBe("/auth/callback?code=[Redacted]&state=xyz");

    expect(
      scrubSentryEvent({
        request: { url: "/oauth/callback#id_token=eyJhbG&access_token=at_abc" },
      }).request?.url,
    ).toBe("/oauth/callback#id_token=[Redacted]&access_token=[Redacted]");
  });

  it("redacts query_string, which Sentry stores without a leading `?`", () => {
    expect(
      scrubSentryEvent({
        request: { query_string: "code=oauth_abc&state=xyz" },
      }).request?.query_string,
    ).toBe("code=[Redacted]&state=xyz");
  });

  it("leaves a non-string query_string alone", () => {
    const parsed = { code: "oauth_abc" };
    expect(
      scrubSentryEvent({ request: { query_string: parsed } }).request
        ?.query_string,
    ).toBe(parsed);
  });

  it("redacts the transaction name, which is the raw URL without tracing", () => {
    expect(
      scrubSentryEvent({ transaction: "POST /auth/reset/rt_abc123" })
        .transaction,
    ).toBe("POST /auth/reset/[Redacted]");
  });

  it("leaves events without request data alone", () => {
    expect(scrubSentryEvent({})).toEqual({});
  });
});
