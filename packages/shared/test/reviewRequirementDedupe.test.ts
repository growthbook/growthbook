import { getRevisionReviewRequirement } from "shared/util";
import { FeatureInterface } from "shared/types/feature";
import { FeatureRevisionInterface } from "shared/types/feature-revision";

// Two governing projects both falling through to the all-projects rule must not
// produce the same requirement twice, or the gate repeats its message.
it("dedupes equivalent rules across governing projects", () => {
  const settings = {
    requireReviews: [
      {
        requireReviewOn: true,
        resetReviewOnChange: false,
        environments: [],
        projects: [],
        requiredApproverTeams: ["t_fin"],
      },
    ],
    targetingReviewMode: [{ projects: [], mode: "strict" as const }],
  };
  const feature = {
    project: "prj_a",
    targetingProjects: ["prj_b"],
    environmentSettings: { production: { enabled: true } },
  } as unknown as FeatureInterface;
  const base = {
    defaultValue: "a",
    rules: [],
    environmentsEnabled: { production: true },
  } as unknown as FeatureRevisionInterface;
  const revision = { ...base, defaultValue: "b" } as FeatureRevisionInterface;

  const out = getRevisionReviewRequirement({
    feature,
    baseRevision: base,
    revision,
    allEnvironments: ["production"],
    settings,
  });

  expect(out.required).toBe(true);
  expect(out.rules).toHaveLength(1);
});
