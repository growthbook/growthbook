import { FeatureRule } from "shared/types/feature";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { applyPartialFeatureRuleUpdatesToRevision } from "back-end/src/util/featureRevision.util";

describe("applyPartialFeatureRuleUpdatesToRevision", () => {
  it("overlays updates onto the targeted rule", () => {
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

  it("overlays updates onto every targeted rule when there are multiple matches", () => {
    const rule0: FeatureRule = {
      id: "r0",
      type: "experiment-ref",
      experimentId: "exp0",
      variations: ["a", "b"],
      enabled: true,
    };
    const rule1: FeatureRule = {
      id: "r1",
      type: "experiment-ref",
      experimentId: "exp1",
      variations: ["c", "d"],
      enabled: false,
    };
    const revision: FeatureRevisionInterface = {
      organization: "org",
      featureId: "feat",
      version: 2,
      baseVersion: 1,
      status: "draft",
      rules: { dev: [{ ...rule0 }], prod: [{ ...rule1 }] },
    };

    const next = applyPartialFeatureRuleUpdatesToRevision(
      revision,
      [
        { environmentId: "dev", i: 0 },
        { environmentId: "prod", i: 0 },
      ],
      { variations: ["x", "y"] },
    );

    expect(next.rules?.dev?.[0].variations).toEqual(["x", "y"]);
    expect(next.rules?.prod?.[0].variations).toEqual(["x", "y"]);
    expect(next.rules?.dev?.[0].experimentId).toEqual("exp0");
    expect(next.rules?.prod?.[0].experimentId).toEqual("exp1");
    expect(revision.rules?.dev?.[0].variations).toEqual(["a", "b"]);
    expect(revision.rules?.prod?.[0].variations).toEqual(["c", "d"]);
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
