import { dashboardWriteFromEvent } from "@/components/Agent/dashboardWrite";

function toolCallEnd(
  method: string,
  path: string,
  output: unknown,
): { type: string; data: Record<string, unknown> } {
  return {
    type: "tool-call-end",
    data: { toolName: "callApi", input: { method, path }, output },
  };
}

const created = {
  status: 200,
  body: { dashboard: { id: "dash_abc" } },
};

describe("dashboardWriteFromEvent", () => {
  it("reads a create off a POST to the collection", () => {
    expect(
      dashboardWriteFromEvent(
        toolCallEnd("POST", "/api/v1/dashboards", created),
      ),
    ).toEqual({ kind: "created", id: "dash_abc" });
  });

  it("accepts every path prefix the dispatcher normalizes", () => {
    for (const path of [
      "/api/v1/dashboards",
      "/v1/dashboards",
      "/dashboards",
    ]) {
      expect(
        dashboardWriteFromEvent(toolCallEnd("POST", path, created)),
      ).toEqual({ kind: "created", id: "dash_abc" });
    }
  });

  it("reads an update off a PUT to one dashboard", () => {
    expect(
      dashboardWriteFromEvent(
        toolCallEnd("PUT", "/api/v1/dashboards/dash_abc", created),
      ),
    ).toEqual({ kind: "updated", id: "dash_abc" });
  });

  it("ignores reads, other resources, and other tools", () => {
    expect(
      dashboardWriteFromEvent(
        toolCallEnd("GET", "/api/v1/dashboards/dash_abc", created),
      ),
    ).toBeNull();
    expect(
      dashboardWriteFromEvent(
        toolCallEnd("POST", "/api/v1/experiments", {
          status: 200,
          body: { experiment: { id: "exp_1" } },
        }),
      ),
    ).toBeNull();
    expect(
      dashboardWriteFromEvent({
        type: "tool-call-end",
        data: {
          toolName: "loadSkill",
          input: { method: "POST", path: "/api/v1/dashboards" },
          output: created,
        },
      }),
    ).toBeNull();
    expect(
      dashboardWriteFromEvent({ type: "tool-call-input", data: {} }),
    ).toBeNull();
  });

  it("ignores a write that failed", () => {
    // A rejected create must not navigate anywhere — there is no dashboard.
    expect(
      dashboardWriteFromEvent(
        toolCallEnd("POST", "/api/v1/dashboards", {
          status: 400,
          body: { dashboard: { id: "dash_abc" } },
        }),
      ),
    ).toBeNull();
    expect(
      dashboardWriteFromEvent(
        toolCallEnd("POST", "/api/v1/dashboards", {
          status: 200,
          body: { message: "Could not run the query" },
        }),
      ),
    ).toBeNull();
  });
});
