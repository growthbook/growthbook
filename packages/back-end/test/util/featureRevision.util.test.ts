import { FeatureRule } from "shared/types/feature";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { applyPartialFeatureRuleUpdatesToRevision } from "back-end/src/util/featureRevision.util";

describe("applyPartialFeatureRuleUpdatesToRevision", () => {
  it("overlays updates onto the targeted rules", () => {
    const rule: FeatureRule = {
      id: "r1",
      type: "experiment-ref",
      experimentId: "exp1",
      variations: ["a", "b"],
      enabled: true,
    };
    const revision: FeatureRevisionInterface = {
      organization: "org",
      featureId: "feat",
      version: 2,
      baseVersion: 1,
      status: "draft",
      rules: {},
    };
    revision.rules = { dev: [{ ...rule }] };

    const next = applyPartialFeatureRuleUpdatesToRevision(
      revision,
      [{ environmentId: "dev", i: 0 }],
      { variations: ["x", "y"] },
    );

    expect(next.rules?.dev?.[0].type).toEqual("experiment-ref");
    expect(next.rules?.dev?.[0].variations).toEqual(["x", "y"]);
    expect(revision.rules?.dev?.[0].variations).toEqual(["a", "b"]);
  });

  it("throws when the rule index is missing", () => {
    const revision: FeatureRevisionInterface = {
      organization: "org",
      featureId: "feat",
      version: 2,
      baseVersion: 1,
      status: "draft",
      rules: { dev: [] },
    };

    expect(() =>
      applyPartialFeatureRuleUpdatesToRevision(
        revision,
        [{ environmentId: "dev", i: 0 }],
        { variations: ["x"] },
      ),
    ).toThrow("Unknown rule");
  });
});
