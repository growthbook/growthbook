import { reviewScopesRequiringTeam } from "shared/util";
import { OrganizationSettings, RequireReview } from "shared/types/organization";

const rule = (over: Partial<RequireReview> = {}): RequireReview => ({
  requireReviewOn: true,
  resetReviewOnChange: false,
  environments: [],
  projects: [],
  ...over,
});

const settings = (requireReviews: OrganizationSettings["requireReviews"]) =>
  ({ requireReviews }) as OrganizationSettings;

describe("reviewScopesRequiringTeam", () => {
  it("reports the org-wide rule that names the team", () => {
    expect(
      reviewScopesRequiringTeam(
        "t_sec",
        settings([
          rule({ requiredApproverTeams: ["t_sec"], environments: ["prod"] }),
        ]),
      ),
    ).toEqual([{ project: null, environments: ["prod"] }]);
  });

  it("returns nothing for a team no rule names", () => {
    expect(
      reviewScopesRequiringTeam(
        "t_sec",
        settings([rule({ requiredApproverTeams: ["t_other"] })]),
      ),
    ).toEqual([]);
  });

  // The under-report a raw filter produces: the override never names the team,
  // but it inherits it, so the team really does gate that project.
  it("reports a project whose override inherits the team", () => {
    expect(
      reviewScopesRequiringTeam(
        "t_sec",
        settings([
          rule({ requiredApproverTeams: ["t_sec"] }),
          rule({ projects: ["prj_a"], environments: ["staging"] }),
        ]),
      ),
    ).toEqual([
      { project: null, environments: [] },
      { project: "prj_a", environments: ["staging"] },
    ]);
  });

  // The over-report: the override replaces the team list, so this team does not
  // gate prj_a even though the org-wide rule names it.
  it("omits a project whose override replaces the team list", () => {
    expect(
      reviewScopesRequiringTeam(
        "t_sec",
        settings([
          rule({ requiredApproverTeams: ["t_sec"] }),
          rule({ projects: ["prj_a"], requiredApproverTeams: ["t_pay"] }),
        ]),
      ),
    ).toEqual([{ project: null, environments: [] }]);
  });

  it("reports a project the org-wide rule does not gate", () => {
    expect(
      reviewScopesRequiringTeam(
        "t_sec",
        settings([
          rule(),
          rule({ projects: ["prj_a"], requiredApproverTeams: ["t_sec"] }),
        ]),
      ),
    ).toEqual([{ project: "prj_a", environments: [] }]);
  });

  it("ignores a rule with review turned off", () => {
    expect(
      reviewScopesRequiringTeam(
        "t_sec",
        settings([
          rule({
            projects: ["prj_a"],
            requireReviewOn: false,
            requiredApproverTeams: ["t_sec"],
          }),
        ]),
      ),
    ).toEqual([]);
  });

  // The legacy boolean form has no rule object to hang a team requirement on.
  it("returns nothing for the legacy boolean setting", () => {
    expect(reviewScopesRequiringTeam("t_sec", settings(true))).toEqual([]);
  });
});
