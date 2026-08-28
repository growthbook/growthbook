import { getReviewSetting } from "shared/util";
import { RequireReview } from "shared/types/organization";

const rule = (over: Partial<RequireReview> = {}): RequireReview => ({
  requireReviewOn: true,
  resetReviewOnChange: false,
  environments: [],
  projects: [],
  ...over,
});

describe("review rule resolution", () => {
  // Every org today has exactly one rule, so this is the no-op case.
  it("returns the single rule unchanged", () => {
    const only = rule({ resetReviewOnChange: true });

    expect(getReviewSetting([only], { project: "prj_a" })).toBe(only);
    expect(getReviewSetting([only], {})).toBe(only);
  });

  it("returns nothing when no rule matches", () => {
    expect(
      getReviewSetting([rule({ projects: ["prj_b"] })], { project: "prj_a" }),
    ).toBeUndefined();
  });

  // The bug this fixes: under first-match-wins a project rule placed after the
  // all-projects rule never applied.
  it("prefers the project rule regardless of array order", () => {
    const base = rule({ requiredApproverTeams: ["t_org"] });
    const specific = rule({
      projects: ["prj_a"],
      requiredApproverTeams: ["t_pay"],
    });

    for (const rules of [
      [base, specific],
      [specific, base],
    ]) {
      expect(
        getReviewSetting(rules, { project: "prj_a" })?.requiredApproverTeams,
      ).toEqual(["t_pay"]);
    }
  });

  it("inherits unset fields from the all-projects rule", () => {
    const base = rule({
      resetReviewOnChange: true,
      blockSelfApproval: true,
      featureRequireMetadataReview: false,
    });
    const specific = rule({
      projects: ["prj_a"],
      requiredApproverTeams: ["t_pay"],
    });

    const merged = getReviewSetting([base, specific], { project: "prj_a" });

    expect(merged?.requiredApproverTeams).toEqual(["t_pay"]);
    expect(merged?.blockSelfApproval).toBe(true);
    expect(merged?.featureRequireMetadataReview).toBe(false);
  });

  // An explicit false must not be treated as "unset" and overwritten by an
  // inherited true.
  it("keeps an explicit false on the override", () => {
    const base = rule({ blockSelfApproval: true, autopublishOnApproval: true });
    const specific = rule({
      projects: ["prj_a"],
      blockSelfApproval: false,
      autopublishOnApproval: false,
    });

    const merged = getReviewSetting([base, specific], { project: "prj_a" });

    expect(merged?.blockSelfApproval).toBe(false);
    expect(merged?.autopublishOnApproval).toBe(false);
  });

  it("does not inherit the selector or the on-switch", () => {
    const base = rule({ requireReviewOn: true, environments: ["production"] });
    const specific = rule({ projects: ["prj_a"], requireReviewOn: false });

    const merged = getReviewSetting([base, specific], { project: "prj_a" });

    expect(merged?.requireReviewOn).toBe(false);
    expect(merged?.projects).toEqual(["prj_a"]);
  });

  // `environments: []` means "all environments", an explicit value, so it stays.
  it("treats an empty environments list as set, not unset", () => {
    const base = rule({ environments: ["production"] });
    const specific = rule({ projects: ["prj_a"], environments: [] });

    expect(
      getReviewSetting([base, specific], { project: "prj_a" })?.environments,
    ).toEqual([]);
  });

  // The REST settings validator marks environments/resetReviewOnChange optional
  // even though the stored type requires them, so a partial rule can exist.
  it("inherits a genuinely absent environments list", () => {
    const base = rule({ environments: ["production"] });
    const partial = {
      requireReviewOn: true,
      projects: ["prj_a"],
    } as RequireReview;

    expect(
      getReviewSetting([base, partial], { project: "prj_a" })?.environments,
    ).toEqual(["production"]);
  });

  it("leaves the stored rules untouched", () => {
    const base = rule({ blockSelfApproval: true });
    const specific = rule({ projects: ["prj_a"] });

    getReviewSetting([base, specific], { project: "prj_a" });

    expect(specific.blockSelfApproval).toBeUndefined();
  });
});
