import { ExperimentSnapshotSettings } from "shared/types/experiment-snapshot";
import {
  getCrossFtPairKey,
  isCrossFtRatioMetric,
  getIncrementalRefreshMetricSources,
} from "back-end/src/queryRunners/ExperimentIncrementalRefreshQueryRunner";
import { SourceIntegrationInterface } from "back-end/src/types/Integration";
import { factMetricFactory } from "../factories/FactMetric.factory";

const integration = {
  getSourceProperties: () => ({ maxColumns: 10000 }),
} as SourceIntegrationInterface;

const snapshotSettings = {
  regressionAdjustmentEnabled: false,
  banditSettings: undefined,
  metricSettings: [],
} as unknown as ExperimentSnapshotSettings;

const sameFtMetric = factMetricFactory.build({
  id: "fact_purchases_count",
  metricType: "mean",
  numerator: { factTableId: "ft_purchases", column: "$$count" },
});

const sameFtRatioMetric = factMetricFactory.build({
  id: "fact_revenue_per_order",
  metricType: "ratio",
  numerator: { factTableId: "ft_purchases", column: "revenue" },
  denominator: { factTableId: "ft_purchases", column: "$$count" },
});

const crossFtRatioMetric = factMetricFactory.build({
  id: "fact_revenue_per_session",
  metricType: "ratio",
  numerator: { factTableId: "ft_purchases", column: "revenue" },
  denominator: { factTableId: "ft_sessions", column: "$$count" },
});

describe("isCrossFtRatioMetric", () => {
  it("returns false for non-ratio metrics", () => {
    expect(isCrossFtRatioMetric(sameFtMetric)).toBe(false);
  });
  it("returns false for same-FT ratio metrics", () => {
    expect(isCrossFtRatioMetric(sameFtRatioMetric)).toBe(false);
  });
  it("returns true for cross-FT ratio metrics", () => {
    expect(isCrossFtRatioMetric(crossFtRatioMetric)).toBe(true);
  });
});

describe("getCrossFtPairKey", () => {
  it("returns null for non-cross-FT metrics", () => {
    expect(getCrossFtPairKey(sameFtMetric)).toBeNull();
    expect(getCrossFtPairKey(sameFtRatioMetric)).toBeNull();
  });
  it("returns a sorted pair key for cross-FT ratio metrics", () => {
    expect(getCrossFtPairKey(crossFtRatioMetric)).toBe(
      "ft_purchases__ft_sessions",
    );
  });
});

describe("getIncrementalRefreshMetricSources cross-FT grouping", () => {
  it("fans cross-FT ratio metric into both numerator and denominator FT groups", () => {
    const groups = getIncrementalRefreshMetricSources({
      metrics: [sameFtMetric, sameFtRatioMetric, crossFtRatioMetric],
      existingMetricSources: [],
      integration,
      snapshotSettings,
    });

    // ft_purchases group: sameFtMetric (both), sameFtRatioMetric (both),
    //                     crossFtRatioMetric (numerator)
    // ft_sessions  group: crossFtRatioMetric (denominator)
    expect(groups).toHaveLength(2);

    const purchasesGroup = groups.find((g) => g.factTableId === "ft_purchases");
    expect(purchasesGroup).toBeDefined();
    // No denominatorFactTableId on the group shape anymore.
    expect(
      (purchasesGroup as { denominatorFactTableId?: string })
        ?.denominatorFactTableId,
    ).toBeUndefined();

    const purchasesMetricIds = purchasesGroup?.metrics
      .map((e) => e.metric.id)
      .sort();
    expect(purchasesMetricIds).toEqual(
      [sameFtMetric.id, sameFtRatioMetric.id, crossFtRatioMetric.id].sort(),
    );

    // Roles within ft_purchases group
    const crossFtEntryInPurchases = purchasesGroup?.metrics.find(
      (e) => e.metric.id === crossFtRatioMetric.id,
    );
    expect(crossFtEntryInPurchases?.role).toBe("numerator");

    const sameFtEntryInPurchases = purchasesGroup?.metrics.find(
      (e) => e.metric.id === sameFtMetric.id,
    );
    expect(sameFtEntryInPurchases?.role).toBe("complete");

    const sessionsGroup = groups.find((g) => g.factTableId === "ft_sessions");
    expect(sessionsGroup).toBeDefined();
    expect(sessionsGroup?.metrics).toHaveLength(1);
    expect(sessionsGroup?.metrics[0].metric.id).toBe(crossFtRatioMetric.id);
    expect(sessionsGroup?.metrics[0].role).toBe("denominator");
  });

  it("reuses existing source group ids for both FTs when cross-FT metric already persisted", () => {
    const groups = getIncrementalRefreshMetricSources({
      metrics: [crossFtRatioMetric],
      existingMetricSources: [
        {
          groupId: "existing_purchases_group",
          factTableId: "ft_purchases",
          metrics: [
            {
              id: crossFtRatioMetric.id,
              settingsHash: "h",
              role: "numerator",
            },
          ],
          maxTimestamp: null,
          tableFullName: "proj.ds.purchases",
        },
        {
          groupId: "existing_sessions_group",
          factTableId: "ft_sessions",
          metrics: [
            {
              id: crossFtRatioMetric.id,
              settingsHash: "h",
              role: "denominator",
            },
          ],
          maxTimestamp: null,
          tableFullName: "proj.ds.sessions",
        },
      ],
      integration,
      snapshotSettings,
    });

    expect(groups).toHaveLength(2);
    const purchasesGroup = groups.find(
      (g) => g.groupId === "existing_purchases_group",
    );
    expect(purchasesGroup).toBeDefined();
    expect(purchasesGroup?.factTableId).toBe("ft_purchases");
    const sessionsGroup = groups.find(
      (g) => g.groupId === "existing_sessions_group",
    );
    expect(sessionsGroup).toBeDefined();
    expect(sessionsGroup?.factTableId).toBe("ft_sessions");
  });
});
