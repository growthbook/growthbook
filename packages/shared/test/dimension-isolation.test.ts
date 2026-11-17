import {
  getIsolatedDimensionIds,
  isIsolatedDimension,
} from "../src/experiments/experiments";

// Minimal settings shapes accepted by the Pick<ExperimentSnapshotSettings, ...>
// the helpers take. Only the fields the helpers read are provided.
const base = {
  dimensions: [] as { id: string }[],
  precomputedUnitDimensionIds: undefined as string[] | undefined,
  isClusterExperiment: undefined as boolean | undefined,
  clusterSubUnitIdentifier: undefined as string | undefined,
};

describe("getIsolatedDimensionIds", () => {
  it("isolates nothing for a plain non-cluster snapshot", () => {
    expect(
      getIsolatedDimensionIds({
        ...base,
        dimensions: [{ id: "exp:browser" }, { id: "pre:date" }],
      }),
    ).toEqual([]);
  });

  it("isolates precomputed unit dimensions for any experiment", () => {
    expect(
      getIsolatedDimensionIds({
        ...base,
        dimensions: [{ id: "exp:browser" }],
        precomputedUnitDimensionIds: ["dim_abc", "dim_def"],
      }),
    ).toEqual(["dim_abc", "dim_def"]);
  });

  it("isolates experiment-kind dimensions for cluster experiments", () => {
    expect(
      getIsolatedDimensionIds({
        ...base,
        isClusterExperiment: true,
        clusterSubUnitIdentifier: "user_id",
        dimensions: [{ id: "exp:browser" }, { id: "precomputed:region" }],
      }),
    ).toEqual(["exp:browser", "precomputed:region"]);
  });

  it("combines precomputed unit dimensions and cluster experiment dimensions", () => {
    expect(
      getIsolatedDimensionIds({
        ...base,
        isClusterExperiment: true,
        clusterSubUnitIdentifier: "user_id",
        dimensions: [{ id: "exp:browser" }],
        precomputedUnitDimensionIds: ["dim_abc"],
      }),
    ).toEqual(["dim_abc", "exp:browser"]);
  });

  it("ignores non-experiment dimensions on cluster experiments", () => {
    expect(
      getIsolatedDimensionIds({
        ...base,
        isClusterExperiment: true,
        clusterSubUnitIdentifier: "user_id",
        dimensions: [
          { id: "exp:browser" },
          { id: "pre:date" },
          { id: "pre:activation" },
          { id: "combo:exp:browser::exp:region" },
          { id: "dim_user_level" },
        ],
      }),
    ).toEqual(["exp:browser"]);
  });

  it("does not treat isClusterExperiment without a sub-unit as a cluster experiment", () => {
    expect(
      getIsolatedDimensionIds({
        ...base,
        isClusterExperiment: true,
        clusterSubUnitIdentifier: undefined,
        dimensions: [{ id: "exp:browser" }],
        precomputedUnitDimensionIds: ["dim_abc"],
      }),
    ).toEqual(["dim_abc"]);
  });

  it("dedupes an id present as both a precomputed unit and cluster dimension", () => {
    expect(
      getIsolatedDimensionIds({
        ...base,
        isClusterExperiment: true,
        clusterSubUnitIdentifier: "user_id",
        dimensions: [{ id: "exp:browser" }],
        precomputedUnitDimensionIds: ["exp:browser"],
      }),
    ).toEqual(["exp:browser"]);
  });
});

describe("isIsolatedDimension", () => {
  const clusterSettings = {
    ...base,
    isClusterExperiment: true,
    clusterSubUnitIdentifier: "user_id",
    dimensions: [{ id: "exp:browser" }, { id: "pre:date" }],
    precomputedUnitDimensionIds: ["dim_abc"],
  };

  it("returns true for an isolated cluster experiment dimension", () => {
    expect(isIsolatedDimension(clusterSettings, "exp:browser")).toBe(true);
  });

  it("returns true for a precomputed unit dimension", () => {
    expect(isIsolatedDimension(clusterSettings, "dim_abc")).toBe(true);
  });

  it("returns false for a non-isolated dimension", () => {
    expect(isIsolatedDimension(clusterSettings, "pre:date")).toBe(false);
  });

  it("returns false for an undefined dimension", () => {
    expect(isIsolatedDimension(clusterSettings, undefined)).toBe(false);
  });

  it("returns false for experiment dimensions on non-cluster snapshots", () => {
    expect(
      isIsolatedDimension(
        { ...base, dimensions: [{ id: "exp:browser" }] },
        "exp:browser",
      ),
    ).toBe(false);
  });
});
