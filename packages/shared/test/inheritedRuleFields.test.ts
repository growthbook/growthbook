import { RequireReview } from "shared/types/organization";
import {
  normalizeApprovalRuleSettings,
  pruneApprovalRuleReferences,
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

// A switched-off rule gates nothing, so it takes no part in inheritance. The
// UI hides a disabled rule's fields, so anything it still stores is invisible;
// letting it donate would enforce requirements no settings screen shows.
describe("a switched-off rule takes no part in inheritance", () => {
  it("does not donate teams left behind on a disabled base rule", () => {
    const resolved = getReviewSetting(
      [
        rule({ requireReviewOn: false }),
        {
          requireReviewOn: true,
          projects: ["prj_a"],
          environments: ["production"],
        },
      ],
      { project: "prj_a" },
    );

    expect(resolved?.requireReviewOn).toBe(true);
    expect(resolved?.requiredApproverTeams).toBeUndefined();
  });

  it("does not donate any other dormant field either", () => {
    const override = rule({ projects: ["prj_a"] });
    delete override.blockSelfApproval;

    const resolved = getReviewSetting(
      [rule({ requireReviewOn: false }), override],
      { project: "prj_a" },
    );

    expect(resolved?.blockSelfApproval).toBeUndefined();
  });

  it("still lets an enabled base rule donate", () => {
    const override = rule({ projects: ["prj_a"] });
    delete override.requiredApproverTeams;

    const resolved = getReviewSetting([rule(), override], { project: "prj_a" });

    expect(resolved?.requiredApproverTeams).toEqual(["t_sec"]);
  });

  it("returns a switched-off override as-is, borrowing nothing beneath it", () => {
    const override = rule({ projects: ["prj_a"], requireReviewOn: false });
    delete override.requiredApproverTeams;

    const resolved = getReviewSetting([rule(), override], { project: "prj_a" });

    expect(resolved?.requireReviewOn).toBe(false);
    expect(resolved?.requiredApproverTeams).toBeUndefined();
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

describe("pruneApprovalRuleReferences", () => {
  const valid = { environments: ["dev"], teams: ["t_keep"] };

  it("drops references to deleted teams and environments", () => {
    const pruned = pruneApprovalRuleReferences(
      {
        requireReviews: [
          {
            requireReviewOn: true,
            projects: [],
            environments: ["dev", "gone_env"],
            requiredApproverTeams: ["t_keep", "t_gone"],
          },
        ],
        approvalFlows: {
          savedGroups: [{ required: true, requiredApproverTeams: ["t_gone"] }],
        },
      },
      valid,
    );
    const rule = (pruned.requireReviews as RequireReview[])[0];
    expect(rule.environments).toEqual(["dev"]);
    expect(rule.requiredApproverTeams).toEqual(["t_keep"]);
    expect(
      pruned.approvalFlows?.savedGroups?.[0].requiredApproverTeams,
    ).toEqual([]);
  });

  it("leaves absent fields absent and the legacy boolean alone", () => {
    const pruned = pruneApprovalRuleReferences(
      { requireReviews: [{ requireReviewOn: true, projects: [] }] },
      valid,
    );
    const rule = (pruned.requireReviews as RequireReview[])[0];
    expect("environments" in rule).toBe(false);
    expect("requiredApproverTeams" in rule).toBe(false);
    expect(
      pruneApprovalRuleReferences({ requireReviews: true }, valid)
        .requireReviews,
    ).toBe(true);
  });
});
