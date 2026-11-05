import type { ExperimentSnapshotSettings } from "shared/types/experiment-snapshot";
import type { FactTableInterface } from "shared/types/fact-table";
import { getMetricSettingsHashForIncrementalRefresh } from "back-end/src/enterprise/services/data-pipeline";
import { getClusterMetricCacheLevel } from "back-end/src/integrations/sql/fact-metrics/cluster-metric-grain";
import { factMetricFactory } from "../factories/FactMetric.factory";

const baseSettings: Pick<
  ExperimentSnapshotSettings,
  "isClusterExperiment" | "clusterSubUnitIdentifier" | "clusterLevelMetricIds"
> = {
  isClusterExperiment: false,
  clusterSubUnitIdentifier: undefined,
  clusterLevelMetricIds: [],
};

describe("getClusterMetricCacheLevel", () => {
  it("returns undefined outside cluster experiments", () => {
    expect(getClusterMetricCacheLevel(baseSettings, "fact_a")).toBeUndefined();
  });

  it("returns undefined when the sub-unit identifier is missing", () => {
    expect(
      getClusterMetricCacheLevel(
        {
          isClusterExperiment: true,
          clusterSubUnitIdentifier: undefined,
          clusterLevelMetricIds: ["fact_a"],
        },
        "fact_a",
      ),
    ).toBeUndefined();
  });

  it("returns 'cluster' for metrics in clusterLevelMetricIds", () => {
    expect(
      getClusterMetricCacheLevel(
        {
          isClusterExperiment: true,
          clusterSubUnitIdentifier: "user_id",
          clusterLevelMetricIds: ["fact_a"],
        },
        "fact_a",
      ),
    ).toBe("cluster");
  });

  it("returns 'subunit' for cluster-experiment metrics not in clusterLevelMetricIds", () => {
    expect(
      getClusterMetricCacheLevel(
        {
          isClusterExperiment: true,
          clusterSubUnitIdentifier: "user_id",
          clusterLevelMetricIds: ["fact_other"],
        },
        "fact_a",
      ),
    ).toBe("subunit");
  });
});

describe("getMetricSettingsHashForIncrementalRefresh cluster level", () => {
  const factTableMap = new Map<string, FactTableInterface>();
  const metric = factMetricFactory.build({
    id: "fact_a",
    metricType: "mean",
    numerator: { factTableId: "ft_a", column: "amount", aggregation: "sum" },
  });

  it("does not change the hash for non-cluster experiments", () => {
    const withoutLevel = getMetricSettingsHashForIncrementalRefresh({
      factMetric: metric,
      factTableMap,
    });
    const withUndefinedLevel = getMetricSettingsHashForIncrementalRefresh({
      factMetric: metric,
      factTableMap,
      clusterMetricLevel: undefined,
    });
    expect(withUndefinedLevel).toEqual(withoutLevel);
  });

  it("produces different hashes for sub-unit vs cluster grain", () => {
    const subUnitHash = getMetricSettingsHashForIncrementalRefresh({
      factMetric: metric,
      factTableMap,
      clusterMetricLevel: "subunit",
    });
    const clusterHash = getMetricSettingsHashForIncrementalRefresh({
      factMetric: metric,
      factTableMap,
      clusterMetricLevel: "cluster",
    });
    expect(subUnitHash).not.toEqual(clusterHash);
  });

  it("keeps the sub-unit hash distinct from the no-level (non-cluster) hash", () => {
    // A metric that moves from a non-cluster experiment into a cluster
    // experiment (or vice versa) must invalidate its cache.
    const noLevelHash = getMetricSettingsHashForIncrementalRefresh({
      factMetric: metric,
      factTableMap,
    });
    const subUnitHash = getMetricSettingsHashForIncrementalRefresh({
      factMetric: metric,
      factTableMap,
      clusterMetricLevel: "subunit",
    });
    expect(subUnitHash).not.toEqual(noLevelHash);
  });
});
