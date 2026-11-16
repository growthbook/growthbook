import { EventEmitter } from "events";
import type { OrganizationInterface } from "shared/types/organization";
import {
  getRoutePath,
  parseContentLength,
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

describe("trackEventForContext", () => {
  const org = {
    id: "org_123",
    dateCreated: new Date("2024-01-01T00:00:00.000Z"),
    licenseKey: "",
    members: [],
    settings: {},
  } as unknown as OrganizationInterface;

  beforeEach(() => {
    mockOrgClientLogEvent.mockClear();
  });

  it("uses the request-scoped client when `req.gb` is present", () => {
    const scopedLogEvent = jest.fn();
    const context = {
      org,
      req: { gb: { logEvent: scopedLogEvent } },
    } as unknown as Parameters<typeof trackEventForContext>[0];

    trackEventForContext(context, "Experiment Started", {
      source: "dashboard",
    });

    expect(scopedLogEvent).toHaveBeenCalledTimes(1);
    expect(scopedLogEvent).toHaveBeenCalledWith("Experiment Started", {
      source: "dashboard",
    });
    expect(mockOrgClientLogEvent).not.toHaveBeenCalled();
  });

  it("falls back to org-scoped tracking when there is no scoped client", () => {
    const context = {
      org,
      req: undefined,
    } as unknown as Parameters<typeof trackEventForContext>[0];

    trackEventForContext(context, "Experiment Started", {
      source: "scheduled-status-update",
    });

    expect(mockOrgClientLogEvent).toHaveBeenCalledTimes(1);
    expect(mockOrgClientLogEvent).toHaveBeenCalledWith(
      "Experiment Started",
      { source: "scheduled-status-update" },
      {
        attributes: expect.objectContaining({ cloudOrgId: expect.anything() }),
      },
    );
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
