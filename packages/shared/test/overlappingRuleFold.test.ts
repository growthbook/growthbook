import { RequireReview } from "shared/types/organization";
import { getReviewSetting } from "../src/util/features";
import { getApprovalFlowSettings } from "../src/revisions/helpers";

const rule = (over: Partial<RequireReview>): RequireReview => ({
  requireReviewOn: true,
  projects: ["prj_a"],
  ...over,
});

// Two rules can name the same project (REST only — no UI authors this). The fold
// must not depend on which one comes first in the array.
describe("folding rules that govern the same project", () => {
  const strict = rule({
    resetReviewOnChange: true,
    blockSelfApproval: true,
    autopublishOnApproval: false,
    environments: ["production"],
    requiredApproverTeams: ["t_sec"],
  });
  const lax = rule({
    resetReviewOnChange: false,
    blockSelfApproval: false,
    autopublishOnApproval: true,
    environments: ["dev"],
    requiredApproverTeams: ["t_pay"],
  });

  it("gives the same answer in either order", () => {
    const a = getReviewSetting([strict, lax], { project: "prj_a" });
    const b = getReviewSetting([lax, strict], { project: "prj_a" });
    expect(a).toEqual(b);
  });

  it("takes the stricter answer on each toggle", () => {
    const merged = getReviewSetting([lax, strict], { project: "prj_a" });
    expect(merged?.resetReviewOnChange).toBe(true);
    expect(merged?.blockSelfApproval).toBe(true);
  });

  // Autopublish loosens the flow, so one rule allowing it is not enough.
  it("allows autopublish only when every rule allows it", () => {
    expect(
      getReviewSetting([strict, lax], { project: "prj_a" })
        ?.autopublishOnApproval,
    ).toBe(false);
    expect(
      getReviewSetting([rule({ autopublishOnApproval: true }), lax], {
        project: "prj_a",
      })?.autopublishOnApproval,
    ).toBe(true);
  });

  it("unions the gated environments", () => {
    expect(
      getReviewSetting([strict, lax], { project: "prj_a" })?.environments,
    ).toEqual(["dev", "production"]);
  });

  // An empty list gates everything, so it swallows any narrower list.
  it("lets an all-environments rule swallow a narrower one", () => {
    expect(
      getReviewSetting([strict, rule({ environments: [] })], {
        project: "prj_a",
      })?.environments,
    ).toEqual([]);
  });

  // OR, not AND: one approver from either team satisfies the requirement, so the
  // fold never manufactures a second-approver demand.
  it("unions required approver teams into one OR-group", () => {
    expect(
      getReviewSetting([strict, lax], { project: "prj_a" })
        ?.requiredApproverTeams,
    ).toEqual(["t_pay", "t_sec"]);
  });

  it("requires review when any rule requires it", () => {
    const off = rule({ requireReviewOn: false });
    expect(
      getReviewSetting([off, rule({ requireReviewOn: true })], {
        project: "prj_a",
      })?.requireReviewOn,
    ).toBe(true);
  });

  // A project-specific rule shadows the base, so an override stays able to be laxer.
  it("does not let the base tighten a project override", () => {
    const base = { requireReviewOn: true, projects: [] } as RequireReview;
    const override = rule({ requireReviewOn: false });
    expect(
      getReviewSetting([base, override], { project: "prj_a" })?.requireReviewOn,
    ).toBe(false);
  });

  // A rule with its switch off contributes nothing, so only the required ones fold.
  it("folds saved-group rules the same way", () => {
    const flows = {
      savedGroups: [
        { required: true, projects: ["prj_a"], blockSelfApproval: true },
        { required: true, projects: ["prj_a"], autopublishOnApproval: true },
      ],
    };
    const forward = getApprovalFlowSettings(flows, "saved-group", ["prj_a"]);
    const reversed = getApprovalFlowSettings(
      { savedGroups: [...flows.savedGroups].reverse() },
      "saved-group",
      ["prj_a"],
    );

    expect(forward).toEqual(reversed);
    expect(forward?.required).toBe(true);
    expect(forward?.blockSelfApproval).toBe(true);
    expect(forward?.autopublishOnApproval).toBe(false);
  });
});
