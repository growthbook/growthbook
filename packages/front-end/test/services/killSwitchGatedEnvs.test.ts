import { FeatureInterface } from "shared/types/feature";
import { RequireReview } from "shared/types/organization";
import { getKillSwitchGatedEnvs } from "@/services/features";

const feature = { project: "" } as FeatureInterface;

function review(overrides: Partial<RequireReview>): RequireReview[] {
  return [
    {
      requireReviewOn: true,
      resetReviewOnChange: false,
      environments: [],
      projects: [],
      ...overrides,
    },
  ];
}

describe("getKillSwitchGatedEnvs", () => {
  it.each([
    ["no review setting", undefined, "none"],
    ["reviews off", false, "none"],
    ["legacy reviews on", true, "all"],
    ["reviews on everywhere", review({}), "all"],
    [
      "kill switches exempt",
      review({ featureRequireEnvironmentReview: false }),
      "none",
    ],
    ["rule turned off", review({ requireReviewOn: false }), "none"],
  ] as const)("%s", (_, requireReviews, expected) => {
    expect(getKillSwitchGatedEnvs(requireReviews, feature)).toBe(expected);
  });

  it("lists the environments a rule names", () => {
    expect(
      getKillSwitchGatedEnvs(review({ environments: ["prod"] }), feature),
    ).toEqual(new Set(["prod"]));
  });
});
