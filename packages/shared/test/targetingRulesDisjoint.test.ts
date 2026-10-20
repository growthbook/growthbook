import { assertTargetingRulesDisjoint } from "shared/util";

describe("assertTargetingRulesDisjoint", () => {
  it("accepts one organization-wide rule plus disjoint project rules", () => {
    expect(() =>
      assertTargetingRulesDisjoint([
        { projects: [] },
        { projects: ["prj_a", "prj_b"] },
        { projects: ["prj_c"] },
      ]),
    ).not.toThrow();
  });

  it("refuses a project named by two rules", () => {
    expect(() =>
      assertTargetingRulesDisjoint([
        { projects: ["prj_a"] },
        { projects: ["prj_b", "prj_a"] },
      ]),
    ).toThrow(
      "Project prj_a appears in more than one targetingReviewMode rule.",
    );
  });

  it("treats an absent selector as the organization-wide rule", () => {
    expect(() => assertTargetingRulesDisjoint([{ projects: [] }, {}])).toThrow(
      "Only one organization-wide targetingReviewMode rule is allowed.",
    );
  });
});
