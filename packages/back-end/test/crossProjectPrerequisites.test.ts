import type { FeatureInterface } from "shared/types/feature";
import type { ExperimentInterface } from "back-end/types/experiment";
import {
  buildPrerequisiteProjectReach,
  expandPayloadKeysForPrerequisites,
  featuresWithPrerequisiteClosure,
  getPrerequisiteIdsInFeatures,
} from "back-end/src/util/features";

type RuleSpec = {
  prerequisites?: string[];
  experimentId?: string;
  enabled?: boolean;
};

const feature = (
  id: string,
  project: string,
  {
    prerequisites = [],
    rules = [],
    targetingProjects,
    targetingAllProjects,
  }: {
    prerequisites?: string[];
    rules?: RuleSpec[];
    targetingProjects?: string[];
    targetingAllProjects?: boolean;
  } = {},
): FeatureInterface =>
  ({
    id,
    project,
    ...(targetingProjects ? { targetingProjects } : {}),
    ...(targetingAllProjects ? { targetingAllProjects } : {}),
    prerequisites: prerequisites.map((p) => ({ id: p, condition: "{}" })),
    rules: rules.map((r, i) => ({
      id: `rule-${i}`,
      type: r.experimentId ? "experiment-ref" : "force",
      ...(r.experimentId ? { experimentId: r.experimentId } : {}),
      allEnvironments: true,
      ...(r.enabled === false ? { enabled: false } : {}),
      ...(r.prerequisites
        ? {
            prerequisites: r.prerequisites.map((p) => ({
              id: p,
              condition: "{}",
            })),
          }
        : {}),
    })),
    environmentSettings: { production: { enabled: true } },
  }) as unknown as FeatureInterface;

const experimentWithPhasePrereq = (
  id: string,
  prereqId: string,
): ExperimentInterface =>
  ({
    id,
    phases: [{ prerequisites: [{ id: prereqId, condition: "{}" }] }],
  }) as unknown as ExperimentInterface;

const mapOf = (features: FeatureInterface[]) =>
  new Map(features.map((f) => [f.id, f]));

describe("getPrerequisiteIdsInFeatures", () => {
  it("collects top-level prerequisites", () => {
    expect(
      getPrerequisiteIdsInFeatures([
        feature("child", "prj_b", { prerequisites: ["root"] }),
      ]),
    ).toEqual(["root"]);
  });

  it("collects rule-level prerequisites", () => {
    expect(
      getPrerequisiteIdsInFeatures([
        feature("child", "prj_b", { rules: [{ prerequisites: ["root"] }] }),
      ]),
    ).toEqual(["root"]);
  });

  it("collects prerequisites from the phase of a referenced experiment", () => {
    const features = [
      feature("child", "prj_b", { rules: [{ experimentId: "exp_a" }] }),
    ];
    const experimentMap = new Map([
      ["exp_a", experimentWithPhasePrereq("exp_a", "root")],
    ]);

    expect(getPrerequisiteIdsInFeatures(features, experimentMap)).toEqual([
      "root",
    ]);
  });

  it("skips disabled rules, which never render", () => {
    expect(
      getPrerequisiteIdsInFeatures([
        feature("child", "prj_b", {
          rules: [{ prerequisites: ["root"], enabled: false }],
        }),
      ]),
    ).toEqual([]);
  });

  it("dedupes a prerequisite reached more than one way", () => {
    expect(
      getPrerequisiteIdsInFeatures([
        feature("child", "prj_b", {
          prerequisites: ["root"],
          rules: [{ prerequisites: ["root"] }],
        }),
        feature("other", "prj_b", { prerequisites: ["root"] }),
      ]),
    ).toEqual(["root"]);
  });
});

describe("featuresWithPrerequisiteClosure", () => {
  // The point of the change: without the parent the gate can never pass.
  it("carries a prerequisite that targets another project", () => {
    const child = feature("child", "prj_b", { prerequisites: ["root"] });
    const root = feature("root", "prj_a");

    const result = featuresWithPrerequisiteClosure(
      [child],
      mapOf([child, root]),
    );

    expect(result.features.map((f) => f.id).sort()).toEqual(["child", "root"]);
    expect([...result.carried]).toEqual(["root"]);
  });

  it("is transitive", () => {
    const child = feature("child", "prj_b", { prerequisites: ["parent"] });
    const parent = feature("parent", "prj_a", { prerequisites: ["grandpa"] });
    const grandpa = feature("grandpa", "prj_a");

    const result = featuresWithPrerequisiteClosure(
      [child],
      mapOf([child, parent, grandpa]),
    );

    expect(result.features.map((f) => f.id).sort()).toEqual([
      "child",
      "grandpa",
      "parent",
    ]);
    expect([...result.carried].sort()).toEqual(["grandpa", "parent"]);
  });

  it("does not re-carry a prerequisite already delivered", () => {
    const child = feature("child", "prj_b", { prerequisites: ["root"] });
    const root = feature("root", "prj_b");

    const result = featuresWithPrerequisiteClosure(
      [child, root],
      mapOf([child, root]),
    );

    expect(result.carried.size).toBe(0);
    expect(result.features).toHaveLength(2);
  });

  it("ignores a dangling prerequisite", () => {
    const child = feature("child", "prj_b", { prerequisites: ["gone"] });

    const result = featuresWithPrerequisiteClosure([child], mapOf([child]));

    expect(result.carried.size).toBe(0);
    expect(result.features.map((f) => f.id)).toEqual(["child"]);
  });

  it("terminates on a prerequisite cycle", () => {
    const a = feature("a", "prj_b", { prerequisites: ["b"] });
    const b = feature("b", "prj_a", { prerequisites: ["a"] });

    const result = featuresWithPrerequisiteClosure([a], mapOf([a, b]));

    expect(result.features.map((f) => f.id).sort()).toEqual(["a", "b"]);
    expect([...result.carried]).toEqual(["b"]);
  });
});

describe("buildPrerequisiteProjectReach", () => {
  it("maps a parent's project to the projects that carry it", () => {
    const child = feature("child", "prj_b", { prerequisites: ["root"] });
    const root = feature("root", "prj_a");

    const reach = buildPrerequisiteProjectReach([child, root]);

    expect([...(reach.get("prj_a") ?? [])]).toEqual(["prj_b"]);
  });

  it("follows the targeting projects of the dependent", () => {
    const child = feature("child", "prj_b", {
      prerequisites: ["root"],
      targetingProjects: ["prj_c"],
    });
    const root = feature("root", "prj_a");

    const reach = buildPrerequisiteProjectReach([child, root]);

    expect([...(reach.get("prj_a") ?? [])].sort()).toEqual(["prj_b", "prj_c"]);
  });

  it("closes over chains", () => {
    const child = feature("child", "prj_c", { prerequisites: ["parent"] });
    const parent = feature("parent", "prj_b", { prerequisites: ["grandpa"] });
    const grandpa = feature("grandpa", "prj_a");

    const reach = buildPrerequisiteProjectReach([child, parent, grandpa]);

    expect([...(reach.get("prj_a") ?? [])].sort()).toEqual(["prj_b", "prj_c"]);
  });

  it("reaches every project when the dependent targets all projects", () => {
    const child = feature("child", "prj_b", {
      prerequisites: ["root"],
      targetingAllProjects: true,
    });
    const root = feature("root", "prj_a");

    const reach = buildPrerequisiteProjectReach(
      [child, root],
      ["prj_a", "prj_b", "prj_c"],
    );

    expect([...(reach.get("prj_a") ?? [])].sort()).toEqual(["prj_b", "prj_c"]);
  });

  it("follows gates on the phase of a referenced experiment", () => {
    const child = feature("child", "prj_b", {
      rules: [{ experimentId: "exp_a" }],
    });
    const root = feature("root", "prj_a");
    const experimentMap = new Map([
      ["exp_a", experimentWithPhasePrereq("exp_a", "root")],
    ]);

    const reach = buildPrerequisiteProjectReach(
      [child, root],
      [],
      experimentMap,
    );

    expect([...(reach.get("prj_a") ?? [])]).toEqual(["prj_b"]);
  });

  it("is empty when no prerequisite crosses a project boundary", () => {
    const child = feature("child", "prj_a", { prerequisites: ["root"] });
    const root = feature("root", "prj_a");

    expect(buildPrerequisiteProjectReach([child, root]).size).toBe(0);
  });
});

describe("expandPayloadKeysForPrerequisites", () => {
  it("adds the projects that carry the changed feature", () => {
    const reach = new Map([["prj_a", new Set(["prj_b"])]]);

    expect(
      expandPayloadKeysForPrerequisites(
        [{ environment: "production", project: "prj_a" }],
        reach,
      ),
    ).toEqual([
      { environment: "production", project: "prj_a" },
      { environment: "production", project: "prj_b" },
    ]);
  });

  it("keeps the environment of the original key", () => {
    const reach = new Map([["prj_a", new Set(["prj_b"])]]);

    expect(
      expandPayloadKeysForPrerequisites(
        [{ environment: "staging", project: "prj_a" }],
        reach,
      ),
    ).toContainEqual({ environment: "staging", project: "prj_b" });
  });

  it("does not duplicate a key already present", () => {
    const reach = new Map([["prj_a", new Set(["prj_b"])]]);

    expect(
      expandPayloadKeysForPrerequisites(
        [
          { environment: "production", project: "prj_a" },
          { environment: "production", project: "prj_b" },
        ],
        reach,
      ),
    ).toHaveLength(2);
  });

  it("returns the keys untouched when nothing reaches", () => {
    const keys = [{ environment: "production", project: "prj_a" }];

    expect(expandPayloadKeysForPrerequisites(keys, new Map())).toBe(keys);
  });
});
