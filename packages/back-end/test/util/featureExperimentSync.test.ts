import { getLaunchDraftVersion } from "back-end/src/util/featureExperimentSync";

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

  it("counts a draft that adds the rule", () => {
    expect(
      getLaunchDraftVersion("exp_1", [revision(2, [ref("b")])], null),
    ).toBe(2);
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
