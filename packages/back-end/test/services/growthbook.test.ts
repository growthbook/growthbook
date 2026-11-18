import { EventEmitter } from "events";
import type { OrganizationInterface } from "shared/types/organization";
import {
  getRequestSource,
  getRoutePath,
  parseContentLength,
  runAsRequestSource,
  trackAIUsage,
  trackEventForContext,
  trackMcpRequestCompletion,
} from "back-end/src/services/growthbook";

const mockOrgClientLogEvent = jest.fn();
const mockOrgClientInit = jest
  .fn()
  .mockResolvedValue({ success: true, source: "test" });

jest.mock("@growthbook/growthbook", () => ({
  GrowthBookClient: jest.fn().mockImplementation(() => ({
    logEvent: mockOrgClientLogEvent,
    init: mockOrgClientInit,
    createScopedInstance: (userContext: unknown) => ({
      logEvent: (name: string, properties: unknown) =>
        mockOrgClientLogEvent(name, properties, userContext),
    }),
  })),
  setPolyfills: jest.fn(),
}));

jest.mock("@growthbook/growthbook/plugins", () => ({
  growthbookTrackingPlugin: jest.fn(),
}));

jest.mock("eventsource", () => ({ EventSource: jest.fn() }));

describe("parseContentLength", () => {
  it("returns undefined when the header is absent", () => {
    expect(parseContentLength(undefined)).toBeUndefined();
  });

  it("parses a numeric header value", () => {
    expect(parseContentLength("1234")).toBe(1234);
  });

  it("parses a zero-length header value", () => {
    expect(parseContentLength("0")).toBe(0);
  });

  it("returns undefined for a non-numeric header value", () => {
    expect(parseContentLength("not-a-number")).toBeUndefined();
  });
});

describe("getRoutePath", () => {
  it("combines baseUrl and the matched route pattern", () => {
    expect(
      getRoutePath({
        path: "/reset/abc123secrettoken",
        baseUrl: "/auth",
        route: { path: "/reset/:token" },
      }),
    ).toBe("/auth/reset/:token");
  });

  it("returns the bare route pattern when there is no baseUrl", () => {
    expect(
      getRoutePath({
        path: "/revision/feature",
        baseUrl: "",
        route: { path: "/revision/feature" },
      }),
    ).toBe("/revision/feature");
  });

  it("falls back to a placeholder instead of the raw path when nothing matched", () => {
    expect(
      getRoutePath({
        path: "/api/keys/sk-live-abc123",
        baseUrl: "",
        route: undefined,
      }),
    ).toBe("(unmatched)");
  });
});

describe("getRequestSource", () => {
  const req = (originalUrl: string, mcpTool?: string) => ({
    originalUrl,
    get: (name: string) => (name === "x-gb-mcp-tool" ? mcpTool : undefined),
  });
  it.each([
    ["the app's API", req("/feature/my-flag"), "app"],
    ["the REST API", req("/api/v1/features"), "api"],
    ["the MCP server", req("/api/v1/features", "list_features"), "mcp"],
    // Only the REST API reads the MCP header.
    ["an app call with the MCP header", req("/feature/x", "tool"), "app"],
  ])("says %s is %s", (_, request, origin) => {
    expect(getRequestSource(request)).toBe(origin);
  });
});

describe("trackEventForContext", () => {
  const org = {
    id: "org_123",
    dateCreated: new Date("2024-01-01T00:00:00.000Z"),
    licenseKey: "",
    members: [],
    settings: {},
  } as unknown as OrganizationInterface;
  type Context = Parameters<typeof trackEventForContext>[0];
  const appRequest = {
    originalUrl: "/feature/my-flag",
    get: () => undefined,
    gbUserContext: {
      attributes: { id: "u_1", session_id: "s_1", requestSource: "app" },
      url: "https://app.growthbook.io/features/my-flag",
    },
  };
  const logged = () => mockOrgClientLogEvent.mock.calls[0];
  const log = (context: object) =>
    trackEventForContext(context as Context, "Experiment Started", {
      source: "test",
    });

  beforeEach(() => {
    mockOrgClientLogEvent.mockClear();
  });

  it("logs an app request with its user, session and page", () => {
    runAsRequestSource("app", () => log({ org, req: appRequest }));
    expect(logged()).toEqual([
      "Experiment Started",
      { source: "test" },
      appRequest.gbUserContext,
    ]);
  });

  it("logs the AI assistant's calls as the assistant's, keeping the user", () => {
    runAsRequestSource("app", () =>
      runAsRequestSource("assistant", () => log({ org, req: appRequest })),
    );
    expect(logged()[2]).toEqual({
      ...appRequest.gbUserContext,
      attributes: {
        ...appRequest.gbUserContext.attributes,
        requestSource: "assistant",
      },
    });
  });

  // A context made inside a request to act for someone else, as an
  // approval's publish runs as its author, still logs the request's origin.
  it("keeps the request's origin across awaits and other contexts", async () => {
    await runAsRequestSource("app", async () => {
      await Promise.resolve();
      log({ org, actingUserId: "u_author" });
    });
    expect(logged()[2].attributes).toEqual(
      expect.objectContaining({ id: "u_author", requestSource: "app" }),
    );
  });

  it.each([
    ["a key", "api", ""],
    ["a personal access token", "api", "u_2"],
    ["a background job", "system", ""],
    ["work nothing marked", null, ""],
  ] as const)(
    "logs %s's events with the org and whoever it acts for",
    (_, origin, actingUserId) => {
      if (origin) runAsRequestSource(origin, () => log({ org, actingUserId }));
      else log({ org, actingUserId });
      const { attributes } = logged()[2];
      expect(attributes).toEqual(
        expect.objectContaining({
          cloudOrgId: expect.anything(),
          requestSource: origin ?? "unknown",
        }),
      );
      expect(attributes.id).toBe(actingUserId || undefined);
      expect(attributes.user_id).toBe(actingUserId || undefined);
    },
  );
});

describe("trackAIUsage", () => {
  const usage = {
    organizationId: "org_123",
    userId: "u_1",
    type: "chat",
    model: "gpt",
    usedDefaultPrompt: true,
    usedOwnKey: false,
  };
  beforeEach(() => mockOrgClientLogEvent.mockClear());

  it.each([
    ["the request it runs in", "app"],
    ["unmarked work", null],
  ] as const)("logs its origin as %s's", (_, origin) => {
    if (origin) runAsRequestSource(origin, () => trackAIUsage(usage));
    else trackAIUsage(usage);
    expect(
      mockOrgClientLogEvent.mock.calls[0][2].attributes.requestSource,
    ).toBe(origin ?? "unknown");
  });
});

describe("trackMcpRequestCompletion", () => {
  const org = {
    id: "org_123",
    dateCreated: new Date("2024-01-01T00:00:00.000Z"),
    licenseKey: "",
    members: [],
    settings: {},
  } as unknown as OrganizationInterface;

  type McpReq = Parameters<typeof trackMcpRequestCompletion>[0];
  type McpRes = Parameters<typeof trackMcpRequestCompletion>[1];

  const mcpHeaders: Record<string, string> = {
    "x-gb-mcp-tool": "growthbook_api_read",
    "x-gb-mcp-version": "2.1.0",
    "x-gb-mcp-transport": "stdio",
    "x-gb-mcp-client": "cursor/1.2.3",
  };

  function makeReq(
    overrides: Record<string, unknown> = {},
    headers: Record<string, string> = mcpHeaders,
  ) {
    return {
      method: "GET",
      path: "/v1/features/my-flag",
      baseUrl: "/api",
      route: { path: "/v1/features/:id" },
      organization: org,
      apiKey: "key_abc",
      get: (name: string) => headers[name.toLowerCase()],
      ...overrides,
    } as unknown as McpReq;
  }

  function run(req: McpReq, statusCode = 200) {
    const res = Object.assign(new EventEmitter(), { statusCode });
    const next = jest.fn();
    trackMcpRequestCompletion(req, res as unknown as McpRes, next);
    expect(next).toHaveBeenCalledTimes(1);
    res.emit("finish");
    // "close" follows "finish" on a normal response; must not double-log
    res.emit("close");
  }

  beforeEach(() => {
    mockOrgClientLogEvent.mockClear();
  });

  it("ignores requests without the MCP tool header", () => {
    run(makeReq({}, {}));
    expect(mockOrgClientLogEvent).not.toHaveBeenCalled();
  });

  it("logs once with the route pattern and MCP headers for a secret key", () => {
    run(makeReq(), 429);

    expect(mockOrgClientLogEvent).toHaveBeenCalledTimes(1);
    expect(mockOrgClientLogEvent).toHaveBeenCalledWith(
      "MCP Request",
      expect.objectContaining({
        tool: "growthbook_api_read",
        mcpVersion: "2.1.0",
        transport: "stdio",
        client: "cursor/1.2.3",
        authType: "secret_key",
        apiKeyId: "key_abc",
        path: "/api/v1/features/:id",
        method: "GET",
        statusCode: 429,
      }),
      {
        attributes: expect.objectContaining({
          id: "",
          accountPlan: expect.anything(),
          cloudOrgId: expect.anything(),
          requestSource: "mcp",
        }),
      },
    );
  });

  it("attributes personal access token calls to the user", () => {
    run(makeReq({ user: { id: "u_1" } }));

    expect(mockOrgClientLogEvent).toHaveBeenCalledWith(
      "MCP Request",
      expect.objectContaining({ authType: "pat" }),
      { attributes: expect.objectContaining({ id: "u_1", user_id: "u_1" }) },
    );
  });

  it("attributes OAuth (JWT) calls to the user without using `req.gb`", () => {
    // req.gb carries the resolved path and full URL; it must not be used here
    const scopedLogEvent = jest.fn();
    run(
      makeReq({
        isJwtAuth: true,
        apiKey: "",
        user: { id: "u_1" },
        gb: { logEvent: scopedLogEvent },
      }),
    );

    expect(scopedLogEvent).not.toHaveBeenCalled();
    expect(mockOrgClientLogEvent).toHaveBeenCalledWith(
      "MCP Request",
      expect.objectContaining({ authType: "oauth", apiKeyId: undefined }),
      {
        attributes: expect.not.objectContaining({
          request_path: expect.anything(),
          url: expect.anything(),
        }),
      },
    );
    expect(mockOrgClientLogEvent.mock.calls[0][2].attributes.id).toBe("u_1");
  });

  it("caps client-controlled header values", () => {
    run(makeReq({}, { ...mcpHeaders, "x-gb-mcp-client": "x".repeat(500) }));

    expect(mockOrgClientLogEvent).toHaveBeenCalledWith(
      "MCP Request",
      expect.objectContaining({ client: "x".repeat(200) }),
      expect.anything(),
    );
  });
});
