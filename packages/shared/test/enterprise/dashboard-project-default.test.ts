import { isDashboardEligibleAsProjectDefault } from "../../src/enterprise/dashboards/project-default";

describe("isDashboardEligibleAsProjectDefault", () => {
  const dashboard = {
    experimentId: "",
    shareLevel: "published" as const,
    projects: [] as string[],
  };

  it("accepts a global dashboard for any project", () => {
    expect(isDashboardEligibleAsProjectDefault(dashboard, "prj_a")).toBe(true);
  });

  it("accepts a dashboard scoped to the project", () => {
    expect(
      isDashboardEligibleAsProjectDefault(
        { ...dashboard, projects: ["prj_a", "prj_b"] },
        "prj_a",
      ),
    ).toBe(true);
  });

  it("rejects a private dashboard", () => {
    expect(
      isDashboardEligibleAsProjectDefault(
        { ...dashboard, shareLevel: "private" },
        "prj_a",
      ),
    ).toBe(false);
  });

  it("rejects an experiment dashboard", () => {
    expect(
      isDashboardEligibleAsProjectDefault(
        { ...dashboard, experimentId: "exp_1" },
        "prj_a",
      ),
    ).toBe(false);
  });

  it("rejects a dashboard whose project list excludes the project", () => {
    expect(
      isDashboardEligibleAsProjectDefault(
        { ...dashboard, projects: ["prj_b"] },
        "prj_a",
      ),
    ).toBe(false);
  });
});
