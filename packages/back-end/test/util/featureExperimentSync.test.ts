import type { FeatureRule } from "shared/validators";
import {
  getLaunchDraftVersion,
  getRuleChangingDraftVersions,
} from "back-end/src/util/featureExperimentSync";

const ref = (value: string, experimentId = "exp_1") => ({
  id: `fr_${experimentId}`,
  type: "experiment-ref",
  experimentId,
  description: "",
  enabled: true,
  allEnvironments: true,
  variations: [
    { variationId: "v0", value: "a" },
    { variationId: "v1", value },
  ],
});
const force = {
  id: "fr_force",
  type: "force",
  value: "x",
  allEnvironments: true,
};
const revision = (version: number, rules: unknown[]) =>
  ({ version, rules }) as never;

describe("getLaunchDraftVersion", () => {
  it("picks the newest draft that changes the experiment's rule, never one that only carries it", () => {
    const live = revision(1, [ref("b")]);
    expect(
      getLaunchDraftVersion(
        "exp_1",
        [
          revision(2, [ref("b-changed")]),
          revision(3, [ref("b-changed-again")]),
          // Someone else's draft: the experiment's rule rides along unchanged.
          revision(4, [ref("b"), force]),
        ],
        live,
      ),
    ).toBe(3);
  });

  it("passes over a draft that holds the rule as it was when the draft was cut", () => {
    const base = revision(1, [ref("b")]);
    const live = revision(3, [ref("b-published")]);
    const stale = { ...revision(4, [ref("b"), force]), base };
    expect(getLaunchDraftVersion("exp_1", [stale], live)).toBeNull();
    expect(
      getLaunchDraftVersion(
        "exp_1",
        [{ ...revision(2, [ref("b-edited")]), base }, stale],
        live,
      ),
    ).toBe(2);
  });

  it("counts a draft that adds the rule", () => {
    expect(
      getLaunchDraftVersion("exp_1", [revision(2, [ref("b")])], null),
    ).toBe(2);
  });

  it("counts a draft whose rule runs in no environment", () => {
    const envless = { ...ref("b"), allEnvironments: false, environments: [] };
    expect(getLaunchDraftVersion("exp_1", [revision(2, [envless])], null)).toBe(
      2,
    );
  });

  it("ignores other experiments' rules", () => {
    const live = revision(1, [ref("b"), ref("x", "exp_2")]);
    expect(
      getLaunchDraftVersion(
        "exp_1",
        [revision(2, [ref("b"), ref("x-changed", "exp_2")])],
        live,
      ),
    ).toBeNull();
  });
});

describe("getRuleChangingDraftVersions", () => {
  it("lists every draft that changes the matched rules, newest first, the launch draft leading", () => {
    const base = revision(1, [ref("b")]);
    const live = revision(3, [ref("b-published")]);
    const drafts = [
      { ...revision(2, [ref("b-edited")]), base },
      // Holds the rule as it was when cut, so it changes nothing.
      { ...revision(4, [ref("b")]), base },
      revision(5, [ref("b-newer")]),
    ];
    const matches = (r: FeatureRule) =>
      r.type === "experiment-ref" && r.experimentId === "exp_1";

    expect(getRuleChangingDraftVersions(matches, drafts, live)).toEqual([5, 2]);
    expect(getLaunchDraftVersion("exp_1", drafts, live)).toBe(5);
  });
});
