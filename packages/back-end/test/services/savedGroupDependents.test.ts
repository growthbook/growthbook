import { findSavedGroupDependents } from "back-end/src/services/savedGroups";

jest.mock("back-end/src/models/FeatureModel", () => ({
  getAllFeaturesForGraph: jest.fn(),
}));
jest.mock("back-end/src/models/ExperimentModel", () => ({
  getAllExperiments: jest.fn(),
  getAllPayloadExperiments: jest.fn(),
  getPayloadKeys: jest.fn(),
  getPayloadKeysForAllEnvs: jest.fn(),
}));

type Args = Parameters<typeof findSavedGroupDependents>[0];

const feature = (id: string, extra: Record<string, unknown> = {}) =>
  ({ id, rules: [], ...extra }) as unknown as Args["features"][number];
const rule = (extra: Record<string, unknown>) => ({
  id: "r",
  type: "force",
  enabled: true,
  allEnvironments: true,
  ...extra,
});
const experiment = (id: string, phase: Record<string, unknown>) =>
  ({ id, phases: [phase] }) as unknown as Args["holdoutExperiments"][number];

const dependents = (args: Partial<Args>) => {
  const result = findSavedGroupDependents({
    groupId: "g",
    savedGroups: [],
    features: [],
    experiments: [],
    holdoutExperiments: [],
    bandits: [],
    ...args,
  });
  return {
    features: result.features.map((f) => f.id),
    experiments: result.experiments.map((e) => e.id),
    holdoutAffected: result.holdoutAffected,
  };
};

describe("findSavedGroupDependents", () => {
  it("finds features naming the group in targeting, conditions and prerequisites", () => {
    const gate = { id: "parent", condition: '{"value":{"$inGroup":"g"}}' };
    expect(
      dependents({
        features: [
          feature("entry", {
            rules: [rule({ savedGroups: [{ match: "all", ids: ["g"] }] })],
          }),
          feature("operator", {
            rules: [rule({ condition: '{"id":{"$notInGroup":"g"}}' })],
          }),
          feature("rule_prereq", { rules: [rule({ prerequisites: [gate] })] }),
          feature("feature_prereq", { prerequisites: [gate] }),
          feature("other", {
            rules: [rule({ savedGroups: [{ match: "all", ids: ["g2"] }] })],
          }),
        ],
      }).features,
    ).toEqual(["entry", "operator", "rule_prereq", "feature_prereq"]);
  });

  it("follows condition groups that reach the group, and stops on cycles", () => {
    expect(
      dependents({
        savedGroups: [
          { id: "outer", condition: '{"$savedGroups":["inner"]}' },
          { id: "inner", condition: '{"$not":{"$savedGroups":["g"]}}' },
          { id: "loop_a", condition: '{"$savedGroups":["loop_b"]}' },
          { id: "loop_b", condition: '{"$savedGroups":["loop_a"]}' },
        ],
        features: [
          feature("via_outer", {
            rules: [rule({ savedGroups: [{ match: "any", ids: ["outer"] }] })],
          }),
          feature("via_loop", {
            rules: [rule({ savedGroups: [{ match: "any", ids: ["loop_a"] }] })],
          }),
        ],
      }).features,
    ).toEqual(["via_outer"]);
  });

  it("finds experiments, bandit-backed features and holdouts naming the group", () => {
    expect(
      dependents({
        experiments: [
          experiment("exp", { savedGroups: [{ match: "all", ids: ["g"] }] }),
          experiment("exp_other", { condition: '{"country":"US"}' }),
        ],
        bandits: [
          { id: "cb", condition: '{"id":{"$inGroup":"g"}}' },
        ] as unknown as Args["bandits"],
        features: [
          feature("bandit_flag", {
            rules: [
              rule({ type: "contextual-bandit-ref", contextualBanditId: "cb" }),
            ],
          }),
        ],
        holdoutExperiments: [
          experiment("holdout", {
            savedGroups: [{ match: "all", ids: ["g"] }],
          }),
        ],
      }),
    ).toEqual({
      features: ["bandit_flag"],
      experiments: ["exp"],
      holdoutAffected: true,
    });
  });

  it("finds nothing for a group no targeting reaches", () => {
    expect(
      dependents({
        features: [feature("f", { rules: [rule({ condition: "{}" })] })],
        experiments: [experiment("e", { condition: "" })],
      }),
    ).toEqual({ features: [], experiments: [], holdoutAffected: false });
  });
});
