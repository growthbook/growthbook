import { RequireReview } from "shared/types/organization";
import {
  normalizeApprovalRuleSettings,
  resolveProjectScopedRule,
} from "../src/util/projectScopedRules";
import { getReviewSetting } from "../src/util/features";

const rule = (over: Partial<RequireReview> = {}): RequireReview => ({
  requireReviewOn: true,
  projects: [],
  environments: ["production"],
  requiredApproverTeams: ["t_sec"],
  blockSelfApproval: true,
  ...over,
});

describe("null unsets an inherited field", () => {
  it("inherits a field the override cleared with null", () => {
    const resolved = getReviewSetting(
      [rule(), rule({ projects: ["prj_a"], requiredApproverTeams: null })],
      { project: "prj_a" },
    );

    expect(resolved?.requiredApproverTeams).toEqual(["t_sec"]);
  });

  // Distinct from null: [] is a real value ("no teams required here").
  it("keeps an empty array as an explicit override", () => {
    const resolved = getReviewSetting(
      [rule(), rule({ projects: ["prj_a"], requiredApproverTeams: [] })],
      { project: "prj_a" },
    );

    expect(resolved?.requiredApproverTeams).toEqual([]);
  });

  it("skips a null layer and keeps looking down the stack", () => {
    const resolved = resolveProjectScopedRule(
      [
        { projects: [], blockSelfApproval: true },
        { projects: ["prj_a"], blockSelfApproval: null },
      ],
      "prj_a",
      ["blockSelfApproval"],
    );

    expect(resolved?.blockSelfApproval).toBe(true);
  });

  it("leaves the field unset when every layer is null", () => {
    const resolved = resolveProjectScopedRule(
      [
        { projects: [], blockSelfApproval: null },
        { projects: ["prj_a"], blockSelfApproval: null },
      ],
      "prj_a",
      ["blockSelfApproval"],
    );

    expect(resolved?.blockSelfApproval).toBeUndefined();
  });
});

describe("normalizeApprovalRuleSettings", () => {
  it("drops nulled fields from both rule families", () => {
    const normalized = normalizeApprovalRuleSettings({
      requireReviews: [
        {
          projects: ["prj_a"],
          requiredApproverTeams: null,
          environments: null,
        },
      ],
      approvalFlows: {
        savedGroups: [{ projects: ["prj_a"], requireMetadataReview: null }],
      },
    } as Parameters<typeof normalizeApprovalRuleSettings>[0]);

    const flagRule = (
      normalized.requireReviews as Record<string, unknown>[]
    )[0];
    expect("requiredApproverTeams" in flagRule).toBe(false);
    expect("environments" in flagRule).toBe(false);
    expect(flagRule.projects).toEqual(["prj_a"]);

    const sgRule = (
      normalized.approvalFlows?.savedGroups as Record<string, unknown>[]
    )[0];
    expect("requireMetadataReview" in sgRule).toBe(false);
  });

  it("leaves the legacy boolean form alone", () => {
    const normalized = normalizeApprovalRuleSettings({ requireReviews: true });
    expect(normalized.requireReviews).toBe(true);
  });
});
