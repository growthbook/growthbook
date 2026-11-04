import nodeFetch from "node-fetch";
import {
  cancellableFetch,
  getAuthProxyForUrl,
  getHttpOptions,
  getWebhookTimeoutMs,
  trimTrailingSlashes,
  validateWebhookTimeoutSeconds,
} from "back-end/src/util/http.util";

// proxy-agent is stubbed in jest.config.js, so assert on the agent's presence, not its class.
jest.mock("node-fetch");
let mockUseProxy = false;
jest.mock("back-end/src/util/secrets", () => ({
  ...jest.requireActual("back-end/src/util/secrets"),
  WEBHOOK_PROXY: "http://smokescreen.test:4750",
  MAX_WEBHOOK_TIMEOUT_SECONDS: 120,
  get USE_PROXY() {
    return mockUseProxy;
  },
}));

const mockedFetch = nodeFetch as unknown as jest.Mock;

function proxyRefused() {
  const err = new Error(
    "request to https://example.com/hook failed, reason: connect ECONNREFUSED 10.0.1.131:4750",
  ) as Error & { code: string };
  err.name = "FetchError";
  err.code = "ECONNREFUSED";
  return err;
}

const abortOptions = { maxTimeMs: 1000, maxContentSize: 1000 };

describe("cancellableFetch with WEBHOOK_PROXY set", () => {
  beforeEach(() => {
    mockedFetch.mockReset();
  });

  it("routes requests through the proxy agent", () => {
    expect(getHttpOptions().agent).toBeDefined();
  });

  it("keeps using the proxy after the proxy refuses a connection", async () => {
    mockedFetch.mockRejectedValueOnce(proxyRefused());
    await expect(
      cancellableFetch("https://example.com/hook", {}, abortOptions),
    ).rejects.toMatchObject({ code: "ECONNREFUSED" });

    mockedFetch.mockRejectedValueOnce(proxyRefused());
    await expect(
      cancellableFetch("https://example.com/hook", {}, abortOptions),
    ).rejects.toMatchObject({ code: "ECONNREFUSED" });

    expect(mockedFetch).toHaveBeenCalledTimes(2);
    for (const [, init] of mockedFetch.mock.calls) {
      expect(init.agent).toBeDefined();
    }
  });
});

describe("getAuthProxyForUrl", () => {
  it.each([
    "https://acme.okta.com/oauth2/v1/keys",
    "https://acme.oktapreview.com/.well-known/openid-configuration",
    "https://acme.us.auth0.com/.well-known/jwks.json",
    "https://login.microsoftonline.com/tenant/discovery/v2.0/keys",
    "https://sts.windows.net/tenant/",
    "https://www.googleapis.com/oauth2/v3/certs",
    "https://accounts.google.com/o/oauth2/v2/auth",
    "https://api.vercel.com/oauth/access_token",
    "https://marketplace.vercel.com/.well-known/jwks",
  ])("bypasses the proxy for %s", (url) => {
    expect(getAuthProxyForUrl(url)).toBe("");
  });

  it("keeps the proxy for identity providers when USE_PROXY is set", () => {
    mockUseProxy = true;
    try {
      expect(getAuthProxyForUrl("https://acme.okta.com/oauth2/v1/keys")).toBe(
        "http://smokescreen.test:4750",
      );
    } finally {
      mockUseProxy = false;
    }
  });

  it.each([
    "https://sso.example.com/.well-known/jwks.json",
    "https://notokta.com/keys",
    "https://okta.com.evil.example/keys",
    "https://deploy.vercel.com/keys",
    "https://10.0.0.5/keys",
  ])("keeps the proxy for %s", (url) => {
    expect(getAuthProxyForUrl(url)).toBe("http://smokescreen.test:4750");
  });
});

describe("webhook timeouts", () => {
  it("defaults to 30s and clamps to MAX_WEBHOOK_TIMEOUT_SECONDS", () => {
    expect(getWebhookTimeoutMs(undefined)).toBe(30000);
    expect(getWebhookTimeoutMs(null)).toBe(30000);
    expect(getWebhookTimeoutMs(5)).toBe(5000);
    expect(getWebhookTimeoutMs(500)).toBe(120000);
  });

  it("rejects timeouts above the max on save", () => {
    expect(() => validateWebhookTimeoutSeconds(undefined)).not.toThrow();
    expect(() => validateWebhookTimeoutSeconds(120)).not.toThrow();
    expect(() => validateWebhookTimeoutSeconds(121)).toThrow("120 seconds");
  });
});

describe("trimTrailingSlashes", () => {
  it("removes all trailing slashes and nothing else", () => {
    expect(trimTrailingSlashes("https://api.example.com")).toBe(
      "https://api.example.com",
    );
    expect(trimTrailingSlashes("https://api.example.com/")).toBe(
      "https://api.example.com",
    );
    expect(trimTrailingSlashes("https://api.example.com/v1///")).toBe(
      "https://api.example.com/v1",
    );
    expect(trimTrailingSlashes("a//b/")).toBe("a//b");
    expect(trimTrailingSlashes("///")).toBe("");
    expect(trimTrailingSlashes("")).toBe("");
  });

  it("is linear on long runs of slashes", () => {
    const input = "/".repeat(500000) + "x" + "/".repeat(500000);
    const start = performance.now();
    expect(trimTrailingSlashes(input)).toBe("/".repeat(500000) + "x");
    expect(performance.now() - start).toBeLessThan(500);
  });
});
