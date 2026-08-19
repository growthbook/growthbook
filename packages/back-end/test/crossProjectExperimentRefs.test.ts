import type { FeatureInterface } from "shared/types/feature";
import type { ExperimentInterface } from "back-end/types/experiment";
import {
  experimentMapForFeatures,
  referencedRefIds,
} from "back-end/src/util/features";

const feature = (
  id: string,
  project: string,
  rules: { experimentId: string; enabled?: boolean }[],
): FeatureInterface =>
  ({
    id,
    project,
    rules: rules.map((r, i) => ({
      id: `rule-${i}`,
      type: "experiment-ref",
      experimentId: r.experimentId,
      allEnvironments: true,
      ...(r.enabled === false ? { enabled: false } : {}),
    })),
    environmentSettings: { production: { enabled: true } },
  }) as unknown as FeatureInterface;

const experiment = (id: string, project: string): ExperimentInterface =>
  ({ id, project }) as unknown as ExperimentInterface;

describe("referencedRefIds", () => {
  it("collects experiment ids from experiment-ref rules", () => {
    const features = [
      feature("f1", "prj_b", [{ experimentId: "exp_a" }]),
      feature("f2", "prj_b", [{ experimentId: "exp_c" }]),
    ];

    expect(referencedRefIds(features, "experiment-ref").sort()).toEqual([
      "exp_a",
      "exp_c",
    ]);
  });

  it("skips disabled rules, which never render", () => {
    const features = [
      feature("f1", "prj_b", [{ experimentId: "exp_a", enabled: false }]),
    ];

    expect(referencedRefIds(features, "experiment-ref")).toEqual([]);
  });

  it("dedupes an experiment referenced by several features", () => {
    const features = [
      feature("f1", "prj_b", [{ experimentId: "exp_a" }]),
      feature("f2", "prj_b", [{ experimentId: "exp_a" }]),
    ];

    expect(referencedRefIds(features, "experiment-ref")).toEqual(["exp_a"]);
  });

  it("ignores features with no rules", () => {
    expect(
      referencedRefIds([feature("f1", "prj_b", [])], "experiment-ref"),
    ).toEqual([]);
  });
});

describe("experimentMapForFeatures", () => {
  const inProject = experiment("exp_b", "prj_b");
  const elsewhere = experiment("exp_a", "prj_a");
  const unrelated = experiment("exp_z", "prj_a");
  const map = new Map([
    [inProject.id, inProject],
    [elsewhere.id, elsewhere],
    [unrelated.id, unrelated],
  ]);

  // The point of the change: a delivered feature's experiment travels with it.
  it("keeps an experiment from another project when a feature references it", () => {
    const features = [feature("f1", "prj_b", [{ experimentId: "exp_a" }])];
    const result = experimentMapForFeatures(map, features, ["prj_b"]);

    expect([...result.keys()].sort()).toEqual(["exp_a", "exp_b"]);
  });

  it("still drops experiments nothing delivered references", () => {
    const features = [feature("f1", "prj_b", [{ experimentId: "exp_a" }])];
    const result = experimentMapForFeatures(map, features, ["prj_b"]);

    expect(result.has("exp_z")).toBe(false);
  });

  it("keeps everything when the connection is not project scoped", () => {
    const result = experimentMapForFeatures(map, [], []);

    expect(result).toBe(map);
  });

  it("does not resurrect an experiment referenced only by a disabled rule", () => {
    const features = [
      feature("f1", "prj_b", [{ experimentId: "exp_a", enabled: false }]),
    ];
    const result = experimentMapForFeatures(map, features, ["prj_b"]);

    expect(result.has("exp_a")).toBe(false);
  });
});

describe("referencedRefIds for contextual bandits", () => {
  const cbFeature = (
    id: string,
    rules: { contextualBanditId?: string; enabled?: boolean }[],
  ): FeatureInterface =>
    ({
      id,
      project: "prj_b",
      rules: rules.map((r, i) => ({
        id: `rule-${i}`,
        type: "contextual-bandit-ref",
        contextualBanditId: r.contextualBanditId,
        allEnvironments: true,
        ...(r.enabled === false ? { enabled: false } : {}),
      })),
    }) as unknown as FeatureInterface;

  it("collects contextual bandit ids from the same walk", () => {
    const features = [
      cbFeature("f1", [{ contextualBanditId: "cb_1" }]),
      cbFeature("f2", [{ contextualBanditId: "cb_2" }]),
    ];

    expect(referencedRefIds(features, "contextual-bandit-ref").sort()).toEqual([
      "cb_1",
      "cb_2",
    ]);
  });

  it("keeps the two rule types apart", () => {
    const features = [
      feature("f1", "prj_b", [{ experimentId: "exp_a" }]),
      cbFeature("f2", [{ contextualBanditId: "cb_1" }]),
    ];

    expect(referencedRefIds(features, "experiment-ref")).toEqual(["exp_a"]);
    expect(referencedRefIds(features, "contextual-bandit-ref")).toEqual([
      "cb_1",
    ]);
  });

  it("ignores a rule with no bandit id", () => {
    expect(
      referencedRefIds([cbFeature("f1", [{}])], "contextual-bandit-ref"),
    ).toEqual([]);
  });
});
