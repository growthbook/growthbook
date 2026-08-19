import type { FeatureInterface } from "shared/types/feature";
import type { ExperimentInterface } from "back-end/types/experiment";
import {
  experimentMapForFeatures,
  referencedExperimentIds,
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

describe("referencedExperimentIds", () => {
  it("collects experiment ids from experiment-ref rules", () => {
    const features = [
      feature("f1", "prj_b", [{ experimentId: "exp_a" }]),
      feature("f2", "prj_b", [{ experimentId: "exp_c" }]),
    ];

    expect(referencedExperimentIds(features).sort()).toEqual([
      "exp_a",
      "exp_c",
    ]);
  });

  it("skips disabled rules, which never render", () => {
    const features = [
      feature("f1", "prj_b", [{ experimentId: "exp_a", enabled: false }]),
    ];

    expect(referencedExperimentIds(features)).toEqual([]);
  });

  it("dedupes an experiment referenced by several features", () => {
    const features = [
      feature("f1", "prj_b", [{ experimentId: "exp_a" }]),
      feature("f2", "prj_b", [{ experimentId: "exp_a" }]),
    ];

    expect(referencedExperimentIds(features)).toEqual(["exp_a"]);
  });

  it("ignores features with no rules", () => {
    expect(referencedExperimentIds([feature("f1", "prj_b", [])])).toEqual([]);
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
