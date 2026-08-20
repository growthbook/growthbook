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

describe("an absent field inherits", () => {
  it("takes the all-projects value for a field the override omits", () => {
    const override = rule({ projects: ["prj_a"] });
    delete override.requiredApproverTeams;

    const resolved = getReviewSetting([rule(), override], {
      project: "prj_a",
    });

    expect(resolved?.requiredApproverTeams).toEqual(["t_sec"]);
  });

  // Distinct from absent: [] is a real value ("no teams required here").
  it("keeps an empty array as an explicit override", () => {
    const resolved = getReviewSetting(
      [rule(), rule({ projects: ["prj_a"], requiredApproverTeams: [] })],
      { project: "prj_a" },
    );

    expect(resolved?.requiredApproverTeams).toEqual([]);
  });

  it("keeps looking down the stack past a layer that omits the field", () => {
    const resolved = resolveProjectScopedRule(
      [{ projects: [], blockSelfApproval: true }, { projects: ["prj_a"] }],
      "prj_a",
      ["blockSelfApproval"],
    );

    expect(resolved?.blockSelfApproval).toBe(true);
  });

  it("leaves the field unset when no layer carries it", () => {
    const resolved = resolveProjectScopedRule(
      [{ projects: [] }, { projects: ["prj_a"] }],
      "prj_a",
      ["blockSelfApproval"],
    );

    expect(resolved?.blockSelfApproval).toBeUndefined();
  });
});

// Absence is the only unset form, so a null from an older client is dropped on
// the way in rather than stored as a second way to say the same thing.
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
    } as unknown as Parameters<typeof normalizeApprovalRuleSettings>[0]);

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
