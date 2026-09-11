import { vi } from "vitest";
import type { OrganizationInterface } from "shared/types/organization";
import {
  getRoutePath,
  parseContentLength,
  trackEventForContext,
} from "back-end/src/services/growthbook";

const mockOrgClientLogEvent = vi.hoisted(() => vi.fn());
const mockOrgClientInit = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ success: true, source: "test" }),
);

vi.mock("@growthbook/growthbook", () => ({
  GrowthBookClient: vi.fn().mockImplementation(() => ({
    logEvent: mockOrgClientLogEvent,
    init: mockOrgClientInit,
  })),
  setPolyfills: vi.fn(),
}));

vi.mock("@growthbook/growthbook/plugins", () => ({
  growthbookTrackingPlugin: vi.fn(),
}));

vi.mock("eventsource", () => ({ EventSource: vi.fn() }));

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
    const scopedLogEvent = vi.fn();
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
