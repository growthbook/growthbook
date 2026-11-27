import { beforeEach, describe, expect, it } from "vitest";
import {
  storeDashboardBuilderHandoff,
  takeDashboardBuilderHandoff,
} from "@/enterprise/components/Dashboards/dashboardBuilderHandoff";

const handoff = {
  text: "Build a signup funnel",
  mentions: [],
  datasourceId: "ds_1",
  mode: "build" as const,
};

describe("dashboard builder handoff", () => {
  beforeEach(() => sessionStorage.clear());

  it("returns a stored handoff once", () => {
    storeDashboardBuilderHandoff("dash_1", handoff);
    expect(takeDashboardBuilderHandoff("dash_1")).toEqual(handoff);
    expect(takeDashboardBuilderHandoff("dash_1")).toBeNull();
  });

  it("keeps handoffs apart by dashboard", () => {
    storeDashboardBuilderHandoff("dash_1", handoff);
    expect(takeDashboardBuilderHandoff("dash_2")).toBeNull();
  });

  it("rejects missing, malformed and wrongly shaped values", () => {
    expect(takeDashboardBuilderHandoff("dash_1")).toBeNull();
    sessionStorage.setItem("dashboard-builder-initial:dash_1", "{not json");
    expect(takeDashboardBuilderHandoff("dash_1")).toBeNull();
    sessionStorage.setItem(
      "dashboard-builder-initial:dash_1",
      JSON.stringify({ text: "x", mode: "delete" }),
    );
    expect(takeDashboardBuilderHandoff("dash_1")).toBeNull();
  });
});
