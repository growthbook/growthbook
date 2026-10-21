import { ApiContextualBanditInterface } from "shared/validators";
import { resolveContextualBanditStatusHealth } from "@/hooks/useContextualBandits";
import { contextualBanditStatusIndicatorData } from "@/services/contextualBandits";

type Health = NonNullable<
  Parameters<typeof resolveContextualBanditStatusHealth>[0]
>;

const cbVariations = [
  { id: "v0" },
  { id: "v1" },
  { id: "v2", status: "pending" },
] as unknown as ApiContextualBanditInterface["variations"];

function makeHealth(fields: Partial<Health>): Health {
  return {
    variations: [
      { variationId: "v0", weight: 0.5 },
      { variationId: "v1", weight: 0.5 },
    ],
    multipleExposures: 0,
    srm: null,
    traffic: null,
    ...fields,
  };
}

function traffic(variationUnits: number[]) {
  return {
    overall: { name: "", srm: 1, variationUnits },
    dimension: {},
  };
}

const persisted = {
  snapshotId: "cbs_old",
  health: {
    srm: 0.2,
    totalUsers: 500,
    multipleExposures: 3,
    variationIds: ["v0", "v1"],
  },
};

describe("resolveContextualBanditStatusHealth", () => {
  it("uses the loaded results' health over the persisted summary", () => {
    expect(
      resolveContextualBanditStatusHealth(
        makeHealth({
          srm: { statistic: 4, pValue: 0.04, degreesOfFreedom: 1 },
          multipleExposures: 9,
          traffic: traffic([60, 40]),
        }),
        persisted,
        cbVariations,
      ),
    ).toEqual({
      srm: 0.04,
      totalUsers: 100,
      multipleExposures: 9,
      variationIds: ["v0", "v1"],
    });
  });

  it("keeps the multiple-exposure count when there is no SRM p-value", () => {
    expect(
      resolveContextualBanditStatusHealth(
        makeHealth({ multipleExposures: 12, traffic: traffic([5, 5]) }),
        undefined,
        cbVariations,
      ),
    ).toEqual({
      srm: null,
      totalUsers: 10,
      multipleExposures: 12,
      variationIds: ["v0", "v1"],
    });
  });

  it("treats a skipped SRM query (null) as zero multiple exposures", () => {
    expect(
      resolveContextualBanditStatusHealth(
        makeHealth({ multipleExposures: null, traffic: traffic([5, 5]) }),
        undefined,
        cbVariations,
      ),
    ).toEqual({
      srm: null,
      totalUsers: 10,
      multipleExposures: 0,
      variationIds: ["v0", "v1"],
    });
  });

  it("returns undefined for loaded results with no traffic", () => {
    expect(
      resolveContextualBanditStatusHealth(
        makeHealth({ traffic: traffic([0, 0]) }),
        persisted,
        cbVariations,
      ),
    ).toBeUndefined();
  });

  it("does not fall back to the persisted summary once results have loaded without health", () => {
    expect(
      resolveContextualBanditStatusHealth(null, persisted, cbVariations),
    ).toBeUndefined();
  });

  it("falls back to the persisted summary while results are still loading", () => {
    expect(
      resolveContextualBanditStatusHealth(undefined, persisted, cbVariations),
    ).toEqual({
      srm: 0.2,
      totalUsers: 500,
      multipleExposures: 3,
      variationIds: ["v0", "v1"],
    });
  });

  it("uses the active arms when a persisted summary predates variationIds", () => {
    expect(
      resolveContextualBanditStatusHealth(
        undefined,
        { snapshotId: "cbs_old", health: { srm: 0.2, totalUsers: 500 } },
        cbVariations,
      )?.variationIds,
    ).toEqual(["v0", "v1"]);
  });

  it("returns undefined when there is no result and no persisted traffic", () => {
    expect(
      resolveContextualBanditStatusHealth(undefined, undefined, cbVariations),
    ).toBeUndefined();
    expect(
      resolveContextualBanditStatusHealth(
        undefined,
        { snapshotId: "cbs_old", health: { srm: null, totalUsers: 0 } },
        cbVariations,
      ),
    ).toBeUndefined();
  });
});

describe("contextualBanditStatusIndicatorData", () => {
  const cb = {
    id: "cb_1",
    status: "running",
    archived: false,
    dateCreated: "2026-10-01T00:00:00.000Z",
    dateStarted: "2026-10-02T00:00:00.000Z",
    variations: [{ id: "v0" }, { id: "v1" }, { id: "v2", status: "pending" }],
    variationWeights: [{ variationId: "v1", weight: 0.7 }],
    seed: "seed",
    datasource: "ds_1",
    decisionMetric: "met_1",
  } as unknown as ApiContextualBanditInterface;

  it("maps health into the analysis summary the status badge reads", () => {
    const data = contextualBanditStatusIndicatorData(cb, {
      srm: 0.01,
      totalUsers: 100,
    });
    expect(data.type).toBe("contextual-bandit");
    // Only active arms count toward health thresholds when no run is known.
    expect(data.variations.map((v) => v.id)).toEqual(["v0", "v1"]);
    expect(data.analysisSummary?.health).toEqual({
      srm: 0.01,
      totalUsers: 100,
      multipleExposures: 0,
    });
  });

  it("sizes variations by the health run's frozen arms when known", () => {
    const data = contextualBanditStatusIndicatorData(cb, {
      srm: 0.5,
      totalUsers: 100,
      variationIds: ["v0", "v1", "v2"],
    });
    expect(data.variations.map((v) => v.id)).toEqual(["v0", "v1", "v2"]);
  });

  it("omits the analysis summary without health", () => {
    expect(
      contextualBanditStatusIndicatorData(cb).analysisSummary,
    ).toBeUndefined();
  });

  it("defaults missing variation weights to 1", () => {
    const data = contextualBanditStatusIndicatorData(cb);
    expect(data.phases[0].variationWeights).toEqual([1, 0.7, 1]);
    expect(data.phases[0].dateStarted).toBe("2026-10-02T00:00:00.000Z");
    expect(data.goalMetrics).toEqual(["met_1"]);
  });
});
