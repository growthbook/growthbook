import {
  POLICIES,
  POLICY_DISPLAY_GROUPS,
  POLICY_METADATA_MAP,
} from "../src/permissions";

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

  it("includes custom hooks in a display group", () => {
    const settingsGroup = POLICY_DISPLAY_GROUPS.find(
      (group) => group.name === "Settings",
    );

    expect(settingsGroup).toBeDefined();
    expect(settingsGroup?.policies).toContain("CustomHooksFullAccess");
  });

  it("includes every policy in at least one display group", () => {
    const allGroupedPolicies = POLICY_DISPLAY_GROUPS.flatMap(
      (group) => group.policies,
    );

    for (const policy of POLICIES) {
      expect(allGroupedPolicies).toContain(policy);
    }
  });
});
