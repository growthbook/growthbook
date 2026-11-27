import type { ReqContext } from "back-end/types/request";
import type { ConversationBuffer } from "back-end/src/enterprise/services/conversation-buffer";
import { dashboardBuilderAgentConfig } from "back-end/src/enterprise/services/dashboard-builder-agent";
import { isReadOnlyAgentCall } from "back-end/src/agent/general-agent";

const tools = (mode: unknown) =>
  Object.keys(
    dashboardBuilderAgentConfig.buildTools(
      {} as ReqContext,
      {} as ConversationBuffer,
      dashboardBuilderAgentConfig.parseParams({ dashboardId: "d", mode }),
    ),
  );

describe("dashboard builder agent", () => {
  it("gives both modes the skill and API tools, and only build the plan tool", () => {
    expect(tools("build")).toEqual(
      expect.arrayContaining(["loadSkill", "callApi", "planDashboard"]),
    );
    expect(tools("ask")).toEqual(
      expect.arrayContaining(["loadSkill", "callApi"]),
    );
    expect(tools("ask")).not.toContain("planDashboard");
  });

  it("defaults to build and ignores an unknown mode", () => {
    expect(dashboardBuilderAgentConfig.parseParams({}).mode).toBe("build");
    expect(dashboardBuilderAgentConfig.parseParams({ mode: "x" }).mode).toBe(
      "build",
    );
  });
});

describe("isReadOnlyAgentCall", () => {
  const call = (method: "GET" | "POST" | "PUT" | "DELETE", path: string) =>
    isReadOnlyAgentCall({ method, path });

  it("allows reads and query runs", () => {
    expect(call("GET", "/api/v2/dashboards/dash_1/draft")).toBe(true);
    expect(call("POST", "/api/v1/product-analytics/metric-exploration")).toBe(
      true,
    );
  });

  it("refuses draft edits, publishing and other writes", () => {
    expect(call("POST", "/api/v2/dashboards/dash_1/draft/blocks")).toBe(false);
    expect(call("PUT", "/api/v2/dashboards/dash_1/draft")).toBe(false);
    expect(call("DELETE", "/api/v2/dashboards/dash_1/draft/blocks/b")).toBe(
      false,
    );
    expect(call("POST", "/api/v2/dashboards/dash_1/draft/publish")).toBe(false);
    expect(call("POST", "/api/v2/dashboards")).toBe(false);
  });
});
