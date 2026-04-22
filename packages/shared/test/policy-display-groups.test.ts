import { POLICY_DISPLAY_GROUPS, POLICY_METADATA_MAP } from "../src/permissions";

describe("policy display groups", () => {
  it("includes product analytic dashboards policy group", () => {
    const dashboardsGroup = POLICY_DISPLAY_GROUPS.find(
      (group) => group.name === "Product Analytic Dashboards",
    );

    expect(dashboardsGroup).toBeDefined();
    expect(dashboardsGroup?.policies).toContain("GeneralDashboardsFullAccess");
    expect(POLICY_METADATA_MAP.GeneralDashboardsFullAccess.displayName).toBe(
      "General Dashboards Full Access",
    );
  });
});
