import {
  isDashboardEligibleAsProjectDefault,
  isProjectDefaultDashboard,
} from "../../src/enterprise/dashboards/project-default";

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

describe("isProjectDefaultDashboard", () => {
  const dashboard = {
    id: "dash_1",
    experimentId: "",
    shareLevel: "published" as const,
    projects: [] as string[],
  };
  const project = { id: "prj_a", defaultDashboardId: "dash_1" };

  it("counts the stored default when it's still eligible", () => {
    expect(isProjectDefaultDashboard(project, dashboard)).toBe(true);
  });

  it("ignores a different dashboard", () => {
    expect(
      isProjectDefaultDashboard(project, { ...dashboard, id: "dash_2" }),
    ).toBe(false);
  });

  it("ignores a stored default that became private", () => {
    expect(
      isProjectDefaultDashboard(project, {
        ...dashboard,
        shareLevel: "private",
      }),
    ).toBe(false);
  });

  it("ignores a Project with no default", () => {
    expect(isProjectDefaultDashboard({ id: "prj_a" }, dashboard)).toBe(false);
  });
});
