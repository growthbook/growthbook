import { ApiContextualBanditInterface } from "shared/validators";
import { resolveContextualBanditStatusHealth } from "@/hooks/useContextualBandits";
import { contextualBanditStatusIndicatorData } from "@/services/contextualBandits";

type Latest = Parameters<typeof resolveContextualBanditStatusHealth>[0];

function makeLatest(fields: Record<string, unknown>): Latest {
  return {
    id: "cbs_1",
    status: "success",
    multipleExposures: 0,
    srm: null,
    traffic: null,
    ...fields,
  } as unknown as Latest;
}

function traffic(variationUnits: number[]) {
  return {
    overall: { name: "", srm: 1, variationUnits },
    dimension: {},
  };
}

const persisted = {
  snapshotId: "cbs_old",
  health: { srm: 0.2, totalUsers: 500, multipleExposures: 3 },
};

describe("resolveContextualBanditStatusHealth", () => {
  it("uses the newest successful run", () => {
    expect(
      resolveContextualBanditStatusHealth(
        makeLatest({
          srm: { pValue: 0.04 },
          multipleExposures: 9,
          traffic: traffic([60, 40]),
        }),
        persisted,
      ),
    ).toEqual({ srm: 0.04, totalUsers: 100, multipleExposures: 9 });
  });

  it("keeps the multiple-exposure count when there is no SRM p-value", () => {
    expect(
      resolveContextualBanditStatusHealth(
        makeLatest({ multipleExposures: 12, traffic: traffic([5, 5]) }),
        undefined,
      ),
    ).toEqual({ srm: null, totalUsers: 10, multipleExposures: 12 });
  });

  it("returns undefined for a successful run with no traffic", () => {
    expect(
      resolveContextualBanditStatusHealth(
        makeLatest({ traffic: traffic([0, 0]) }),
        persisted,
      ),
    ).toBeUndefined();
  });

  it("falls back to the persisted summary while a run is in progress", () => {
    expect(
      resolveContextualBanditStatusHealth(
        makeLatest({ status: "running" }),
        persisted,
      ),
    ).toEqual({ srm: 0.2, totalUsers: 500, multipleExposures: 3 });
  });

  it("returns undefined when there is no result and no persisted traffic", () => {
    expect(
      resolveContextualBanditStatusHealth(null, undefined),
    ).toBeUndefined();
    expect(
      resolveContextualBanditStatusHealth(null, {
        snapshotId: "cbs_old",
        health: { srm: null, totalUsers: 0 },
      }),
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
    variations: [{ id: "v0" }, { id: "v1" }],
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
    expect(data.analysisSummary?.health).toEqual({
      srm: 0.01,
      totalUsers: 100,
      multipleExposures: 0,
    });
  });

  it("omits the analysis summary without health", () => {
    expect(
      contextualBanditStatusIndicatorData(cb).analysisSummary,
    ).toBeUndefined();
  });

  it("defaults missing variation weights to 1", () => {
    const data = contextualBanditStatusIndicatorData(cb);
    expect(data.phases[0].variationWeights).toEqual([1, 0.7]);
    expect(data.phases[0].dateStarted).toBe("2026-10-02T00:00:00.000Z");
    expect(data.goalMetrics).toEqual(["met_1"]);
  });
});
