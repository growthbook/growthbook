import { getRuleAttributeScopeProjectIds } from "shared/util";

const feature = { project: "prj_b", targetingProjects: ["prj_a"] };

describe("getRuleAttributeScopeProjectIds", () => {
  it("is the feature's scope when the rule targets every project", () => {
    expect(
      getRuleAttributeScopeProjectIds(feature, undefined, {
        allProjects: true,
      }),
    ).toEqual(["prj_b", "prj_a"]);
    expect(getRuleAttributeScopeProjectIds(feature, undefined, {})).toEqual([
      "prj_b",
      "prj_a",
    ]);
  });

  it("narrows to the projects the rule targets within the delivery set", () => {
    expect(
      getRuleAttributeScopeProjectIds(feature, undefined, {
        allProjects: false,
        projects: ["prj_a"],
      }),
    ).toEqual(["prj_a"]);
    // Staged targeting counts, as it does for the feature-level scope.
    expect(
      getRuleAttributeScopeProjectIds(
        feature,
        { targetingProjects: ["prj_a", "prj_c"] },
        { allProjects: false, projects: ["prj_c"] },
      ),
    ).toEqual(["prj_c"]);
  });

  // A rule outside the delivery set, or scoped to no project, reaches nowhere.
  it("does not narrow when the rule's scope misses the delivery set", () => {
    expect(
      getRuleAttributeScopeProjectIds(feature, undefined, {
        allProjects: false,
        projects: ["prj_z"],
      }),
    ).toEqual(["prj_b", "prj_a"]);
    expect(
      getRuleAttributeScopeProjectIds(feature, undefined, {
        allProjects: false,
        projects: [],
      }),
    ).toEqual(["prj_b", "prj_a"]);
  });

  it("is the rule's scope when the feature is unscoped", () => {
    expect(
      getRuleAttributeScopeProjectIds(
        { ...feature, targetingAllProjects: true },
        undefined,
        { allProjects: false, projects: ["prj_a"] },
      ),
    ).toEqual(["prj_a"]);
    expect(
      getRuleAttributeScopeProjectIds(
        { ...feature, targetingAllProjects: true },
        undefined,
        { allProjects: true },
      ),
    ).toBeNull();
  });
});
