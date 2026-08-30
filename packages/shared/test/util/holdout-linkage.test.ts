import {
  computeHoldoutExperimentLinkageDelta,
  getExperimentIdsFromRules,
} from "../../src/util/features";
import { FeatureRule } from "../../types/feature";

function expRule(experimentId: string, id = experimentId): FeatureRule {
  return {
    id,
    type: "experiment-ref",
    experimentId,
    variations: [],
    enabled: true,
    description: "",
  } as unknown as FeatureRule;
}

function forceRule(id: string): FeatureRule {
  return {
    id,
    type: "force",
    value: "true",
    enabled: true,
    description: "",
  } as unknown as FeatureRule;
}

describe("getExperimentIdsFromRules", () => {
  it("returns only experiment-ref ids, deduped", () => {
    expect(
      getExperimentIdsFromRules([
        expRule("exp_a", "r1"),
        forceRule("r2"),
        expRule("exp_a", "r3"),
        expRule("exp_b", "r4"),
      ]),
    ).toEqual(["exp_a", "exp_b"]);
  });

  it("returns nothing for an empty rule set", () => {
    expect(getExperimentIdsFromRules([])).toEqual([]);
  });
});

describe("computeHoldoutExperimentLinkageDelta", () => {
  it("links experiments the published rules added", () => {
    expect(
      computeHoldoutExperimentLinkageDelta({
        publishedRules: [expRule("exp_a"), expRule("exp_b")],
        previousRules: [expRule("exp_a")],
        linkedExperimentIds: ["exp_a"],
        experimentIdsReferencedElsewhere: [],
      }),
    ).toEqual({ toLink: ["exp_b"], toUnlink: [] });
  });

  it("unlinks experiments the published rules dropped", () => {
    expect(
      computeHoldoutExperimentLinkageDelta({
        publishedRules: [expRule("exp_a")],
        previousRules: [expRule("exp_a"), expRule("exp_b")],
        linkedExperimentIds: ["exp_a", "exp_b"],
        experimentIdsReferencedElsewhere: [],
      }),
    ).toEqual({ toLink: [], toUnlink: ["exp_b"] });
  });

  // The case that makes a blind scrub unsafe: another feature in the same
  // holdout still references the experiment, so publishing this one must not
  // revoke a membership that feature is relying on.
  it("keeps an experiment another feature still references", () => {
    expect(
      computeHoldoutExperimentLinkageDelta({
        publishedRules: [],
        previousRules: [expRule("exp_a"), expRule("exp_b")],
        linkedExperimentIds: ["exp_a", "exp_b"],
        experimentIdsReferencedElsewhere: ["exp_a"],
      }),
    ).toEqual({ toLink: [], toUnlink: ["exp_b"] });
  });

  // Leaving the holdout is expressed by publishing no rules under it.
  it("unlinks everything unreferenced when the feature leaves the holdout", () => {
    expect(
      computeHoldoutExperimentLinkageDelta({
        publishedRules: [],
        previousRules: [expRule("exp_a"), expRule("exp_b")],
        linkedExperimentIds: ["exp_a", "exp_b"],
        experimentIdsReferencedElsewhere: [],
      }),
    ).toEqual({ toLink: [], toUnlink: ["exp_a", "exp_b"] });
  });

  it("is a no-op when published rules already match the linkage", () => {
    expect(
      computeHoldoutExperimentLinkageDelta({
        publishedRules: [expRule("exp_a")],
        previousRules: [expRule("exp_a")],
        linkedExperimentIds: ["exp_a"],
        experimentIdsReferencedElsewhere: [],
      }),
    ).toEqual({ toLink: [], toUnlink: [] });
  });

  it("ignores non-experiment rules", () => {
    expect(
      computeHoldoutExperimentLinkageDelta({
        publishedRules: [forceRule("r1")],
        previousRules: [forceRule("r1")],
        linkedExperimentIds: [],
        experimentIdsReferencedElsewhere: [],
      }),
    ).toEqual({ toLink: [], toUnlink: [] });
  });

  // Regression: an experiment can be added to a holdout directly, with no
  // feature referencing it. Publishing an unrelated feature must not withdraw
  // it just because no feature's rules mention it.
  it("leaves experiments this feature never contributed alone", () => {
    expect(
      computeHoldoutExperimentLinkageDelta({
        publishedRules: [expRule("exp_mine")],
        previousRules: [expRule("exp_mine")],
        linkedExperimentIds: ["exp_mine", "exp_added_directly"],
        experimentIdsReferencedElsewhere: [],
      }),
    ).toEqual({ toLink: [], toUnlink: [] });
  });

  it("withdraws only its own contribution when it leaves the holdout", () => {
    expect(
      computeHoldoutExperimentLinkageDelta({
        publishedRules: [],
        previousRules: [expRule("exp_mine")],
        linkedExperimentIds: ["exp_mine", "exp_added_directly"],
        experimentIdsReferencedElsewhere: [],
      }),
    ).toEqual({ toLink: [], toUnlink: ["exp_mine"] });
  });
});
