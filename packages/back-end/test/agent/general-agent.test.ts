// Mock the same import chain dispatcher.test.ts mocks. general-agent.ts
// transitively imports the dispatcher (which imports api.router) — without
// the stub, the whole app loads and the test takes 30+ seconds.
jest.mock("back-end/src/api/api.router", () => ({
  allRoutes: [],
}));

// Stub createAgentHandler so we don't try to spin up the real handler in
// this unit test. We only care about the coerceBody helper.
jest.mock("back-end/src/enterprise/services/agent-handler", () => ({
  createAgentHandler: () => async () => undefined,
}));

import type { AIChatMessage } from "shared/ai-chat";
import {
  _buildGeneralAgentSystemPrompt,
  _coerceBody,
  _offScreenDashboardUpdate,
  _requiresMutationConfirmation,
} from "back-end/src/agent/general-agent";

describe("general agent system prompt", () => {
  it("translates canonical skill runtime instructions", () => {
    const prompt = _buildGeneralAgentSystemPrompt();

    expect(prompt).toContain(
      "translate every `gb-call METHOD PATH [body]` example into",
    );
    expect(prompt).toContain("Never run shell commands");
    expect(prompt).toMatch(
      /Ignore API-key, host,\s+`gb-setup`, and credential instructions/,
    );
  });
});

describe("coerceBody (callApi defensive parsing)", () => {
  it("returns objects unchanged", () => {
    const obj = { type: "metric", values: [{ name: "x" }] };
    expect(_coerceBody(obj)).toBe(obj);
  });

  it("returns arrays unchanged", () => {
    const arr = [1, 2, 3];
    expect(_coerceBody(arr)).toBe(arr);
  });

  it("returns undefined and null unchanged", () => {
    expect(_coerceBody(undefined)).toBeUndefined();
    expect(_coerceBody(null)).toBeNull();
  });

  it("parses a JSON-encoded object string into an object", () => {
    const payload = JSON.stringify({ type: "metric", chartType: "line" });
    expect(_coerceBody(payload)).toEqual({ type: "metric", chartType: "line" });
  });

  it("parses a JSON-encoded array string into an array", () => {
    const payload = JSON.stringify([{ a: 1 }, { a: 2 }]);
    expect(_coerceBody(payload)).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("parses through leading/trailing whitespace and newlines", () => {
    const payload = `\n  ${JSON.stringify({ x: 1 })}\n`;
    expect(_coerceBody(payload)).toEqual({ x: 1 });
  });

  it("leaves a non-JSON string alone", () => {
    expect(_coerceBody("hello world")).toBe("hello world");
  });

  it("leaves a malformed JSON-looking string alone (handler will reject)", () => {
    const malformed = '{"type": "metric"';
    expect(_coerceBody(malformed)).toBe(malformed);
  });

  it("does not parse plain numeric or boolean strings", () => {
    // These start with neither { nor [, so coerceBody should leave them as-is.
    expect(_coerceBody("42")).toBe("42");
    expect(_coerceBody("true")).toBe("true");
  });
});

describe("requiresMutationConfirmation (deterministic mutation gate)", () => {
  it("never gates GET requests", () => {
    expect(
      _requiresMutationConfirmation({
        method: "GET",
        path: "/api/v1/features",
      }),
    ).toBe(false);
    expect(
      _requiresMutationConfirmation({
        method: "GET",
        path: "/api/v2/features/eval-cycle-flag",
      }),
    ).toBe(false);
  });

  it("gates feature flag mutations", () => {
    expect(
      _requiresMutationConfirmation({
        method: "POST",
        path: "/api/v2/features",
      }),
    ).toBe(true);
    expect(
      _requiresMutationConfirmation({
        method: "DELETE",
        path: "/api/v2/features/eval-cycle-flag",
      }),
    ).toBe(true);
  });

  it("gates experiment mutations", () => {
    expect(
      _requiresMutationConfirmation({
        method: "PATCH",
        path: "/api/v1/experiments/exp_123",
      }),
    ).toBe(true);
  });

  it("gates mutations to other resource types (metrics, projects, saved groups)", () => {
    expect(
      _requiresMutationConfirmation({
        method: "POST",
        path: "/api/v1/metrics",
      }),
    ).toBe(true);
    expect(
      _requiresMutationConfirmation({
        method: "DELETE",
        path: "/api/v1/projects/prj_1",
      }),
    ).toBe(true);
    expect(
      _requiresMutationConfirmation({
        method: "PUT",
        path: "/api/v1/saved-groups/grp_1",
      }),
    ).toBe(true);
  });

  it("allows experiment snapshot refreshes without confirmation", () => {
    expect(
      _requiresMutationConfirmation({
        method: "POST",
        path: "/api/v1/experiments/exp_123/snapshot",
      }),
    ).toBe(false);
  });

  it("allows product analytics exploration POSTs without confirmation", () => {
    expect(
      _requiresMutationConfirmation({
        method: "POST",
        path: "/api/v1/product-analytics/metric-exploration",
      }),
    ).toBe(false);
    expect(
      _requiresMutationConfirmation({
        method: "POST",
        path: "/api/v1/product-analytics/fact-table-exploration",
      }),
    ).toBe(false);
    expect(
      _requiresMutationConfirmation({
        method: "POST",
        path: "/api/v1/product-analytics/data-source-exploration",
      }),
    ).toBe(false);
    expect(
      _requiresMutationConfirmation({
        method: "POST",
        path: "/api/v1/product-analytics/funnel-exploration",
      }),
    ).toBe(false);
  });

  it("still gates a dashboard create", () => {
    // The card is the user's only review of a multi-block dashboard.
    expect(
      _requiresMutationConfirmation({
        method: "POST",
        path: "/api/v1/dashboards",
      }),
    ).toBe(true);
  });

  it("ignores query strings when matching the allowlist", () => {
    expect(
      _requiresMutationConfirmation({
        method: "POST",
        path: "/api/v1/experiments/exp_123/snapshot?force=true",
      }),
    ).toBe(false);
  });
});

describe("offScreenDashboardUpdate (the dashboard on screen is the only one)", () => {
  const onPage = (currentPage?: string): AIChatMessage[] => [
    { role: "assistant", id: "a", ts: 0, content: "earlier" },
    {
      role: "user",
      id: "u",
      ts: 1,
      content: "change it",
      ...(currentPage ? { currentPage } : {}),
    },
  ];

  const viewing = onPage("/product-analytics/dashboards/dash_abc");

  const put = (path: string) => ({ method: "PUT" as const, path });

  it("allows an update to the dashboard the user is viewing", () => {
    expect(
      _offScreenDashboardUpdate(put("/api/v1/dashboards/dash_abc"), viewing),
    ).toBeUndefined();
  });

  it("allows it whatever prefix or query string the model sent", () => {
    for (const path of [
      "/dashboards/dash_abc",
      "/v1/dashboards/dash_abc",
      "/api/v1/dashboards/dash_abc?foo=1",
      "/api/v1/dashboards/dash_abc/",
    ]) {
      expect(_offScreenDashboardUpdate(put(path), viewing)).toBeUndefined();
    }
  });

  it("rejects an update to any other dashboard, and names both", () => {
    const rejection = _offScreenDashboardUpdate(
      put("/api/v1/dashboards/dash_other"),
      viewing,
    );

    expect(rejection?.status).toBe("rejected");
    expect(rejection?.message).toContain("dash_abc");
    expect(rejection?.message).toContain("dash_other");
    expect(rejection?.message).toContain("Do not retry");
  });

  it("rejects an update when the user is not on a dashboard at all", () => {
    // Browsing the list is the motivating case: every title is right there.
    for (const page of [
      "/product-analytics/dashboards",
      "/features/dark-mode",
      undefined,
    ]) {
      expect(
        _offScreenDashboardUpdate(
          put("/api/v1/dashboards/dash_abc"),
          onPage(page),
        ),
      ).toMatchObject({ status: "rejected" });
    }
  });

  it("reads the newest page context, not the first one in the thread", () => {
    const navigated: AIChatMessage[] = [
      ...onPage("/product-analytics/dashboards/dash_old"),
      {
        role: "user",
        id: "u2",
        ts: 2,
        content: "now this one",
        currentPage: "/product-analytics/dashboards/dash_new",
      },
    ];

    expect(
      _offScreenDashboardUpdate(put("/api/v1/dashboards/dash_new"), navigated),
    ).toBeUndefined();
    expect(
      _offScreenDashboardUpdate(put("/api/v1/dashboards/dash_old"), navigated),
    ).toMatchObject({ status: "rejected" });
  });

  it("leaves creates, reads, and other resources alone", () => {
    expect(
      _offScreenDashboardUpdate(
        { method: "POST", path: "/api/v1/dashboards" },
        onPage("/features/dark-mode"),
      ),
    ).toBeUndefined();
    expect(
      _offScreenDashboardUpdate(
        { method: "GET", path: "/api/v1/dashboards/dash_other" },
        viewing,
      ),
    ).toBeUndefined();
    expect(
      _offScreenDashboardUpdate(
        put("/api/v1/experiments/exp_1"),
        onPage("/features/dark-mode"),
      ),
    ).toBeUndefined();
  });
});
