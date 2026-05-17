import { ExperimentSnapshotSettings } from "shared/types/experiment-snapshot";
import {
  getCrossFtDenominatorFactTableId,
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

describe("getCrossFtDenominatorFactTableId", () => {
  it("returns undefined for non-ratio metrics", () => {
    expect(getCrossFtDenominatorFactTableId(sameFtMetric)).toBeUndefined();
  });
  it("returns undefined for same-FT ratio metrics", () => {
    expect(getCrossFtDenominatorFactTableId(sameFtRatioMetric)).toBeUndefined();
  });
  it("returns the denominator fact table id for cross-FT ratio metrics", () => {
    expect(getCrossFtDenominatorFactTableId(crossFtRatioMetric)).toBe(
      "ft_sessions",
    );
  });
});

describe("getIncrementalRefreshMetricSources cross-FT grouping", () => {
  it("keeps cross-FT ratio metrics in their own group with a denominator fact table id", () => {
    const groups = getIncrementalRefreshMetricSources({
      metrics: [sameFtMetric, sameFtRatioMetric, crossFtRatioMetric],
      existingMetricSources: [],
      integration,
      snapshotSettings,
    });

    // Same-FT metrics share a group; the cross-FT ratio metric gets its own.
    expect(groups).toHaveLength(2);

    const crossFtGroup = groups.find((g) =>
      g.metrics.some((m) => m.id === crossFtRatioMetric.id),
    );
    expect(crossFtGroup).toBeDefined();
    expect(crossFtGroup?.factTableId).toBe("ft_purchases");
    expect(crossFtGroup?.denominatorFactTableId).toBe("ft_sessions");
    expect(crossFtGroup?.metrics.map((m) => m.id)).toEqual([
      crossFtRatioMetric.id,
    ]);

    const sameFtGroup = groups.find((g) =>
      g.metrics.some((m) => m.id === sameFtMetric.id),
    );
    expect(sameFtGroup).toBeDefined();
    expect(sameFtGroup?.factTableId).toBe("ft_purchases");
    expect(sameFtGroup?.denominatorFactTableId).toBeUndefined();
    expect(sameFtGroup?.metrics.map((m) => m.id).sort()).toEqual(
      [sameFtMetric.id, sameFtRatioMetric.id].sort(),
    );
  });

  it("preserves denominator fact table id when reusing an existing group", () => {
    const groups = getIncrementalRefreshMetricSources({
      metrics: [crossFtRatioMetric],
      existingMetricSources: [
        {
          groupId: "ft_purchases_ft_sessions_abc0",
          factTableId: "ft_purchases",
          denominatorFactTableId: "ft_sessions",
          denominatorTableFullName: "proj.ds.denom",
          denominatorMaxTimestamp: null,
          metrics: [{ id: crossFtRatioMetric.id, settingsHash: "h" }],
          maxTimestamp: null,
          tableFullName: "proj.ds.num",
        },
      ],
      integration,
      snapshotSettings,
    });

    expect(groups).toHaveLength(1);
    expect(groups[0].groupId).toBe("ft_purchases_ft_sessions_abc0");
    expect(groups[0].denominatorFactTableId).toBe("ft_sessions");
  });
});
