import type { ExperimentSnapshotSettings } from "shared/types/experiment-snapshot";

// Resolves the id-type grain for a per-experiment metric source cache (and its
// covariate cache) in a cluster experiment.
//
// Cluster experiments analyze two metric grains, and the fan-out keeps them in
// separate caches (see `cluster:` group keys):
//   - sub-unit metrics: aggregated per sub-unit (e.g. user_id) and rolled up to
//     the cluster downstream, so the cache is keyed on the sub-unit id.
//   - cluster-level metrics: the cluster is the analysis unit, so the cache is
//     keyed on the cluster id (the exposure identifier).
//
// For non-cluster experiments the cache is keyed on the exposure identifier, as
// before.
export interface ClusterMetricGrain {
  // The id type the cache is keyed on (sub-unit id, cluster id, or the exposure
  // identifier for non-cluster experiments).
  baseIdType: string;
  // True when every metric in the group is a cluster-level metric (cluster as
  // the analysis unit). False for sub-unit groups and non-cluster experiments.
  isClusterLevelGroup: boolean;
  // The sub-unit identifier when this is a cluster experiment, else null.
  clusterSubUnit: string | null;
}

export function resolveClusterMetricGrain({
  settings,
  metrics,
  exposureIdentifierType,
}: {
  settings: Pick<
    ExperimentSnapshotSettings,
    "isClusterExperiment" | "clusterSubUnitIdentifier" | "clusterLevelMetricIds"
  >;
  metrics: { id: string }[];
  exposureIdentifierType: string;
}): ClusterMetricGrain {
  const clusterSubUnit =
    settings.isClusterExperiment && settings.clusterSubUnitIdentifier
      ? settings.clusterSubUnitIdentifier
      : null;
  if (!clusterSubUnit) {
    return {
      baseIdType: exposureIdentifierType,
      isClusterLevelGroup: false,
      clusterSubUnit: null,
    };
  }

  const clusterLevelMetricIds = new Set(settings.clusterLevelMetricIds ?? []);
  const clusterLevelCount = metrics.filter((m) =>
    clusterLevelMetricIds.has(m.id),
  ).length;
  // The fan-out routes cluster-level and sub-unit metrics into separate caches,
  // so a single cache must be entirely one grain. A mixed group means the
  // grouping upstream is broken.
  if (clusterLevelCount > 0 && clusterLevelCount < metrics.length) {
    throw new Error(
      "ImplementationError: cluster-level and sub-unit metrics cannot share a metric source cache",
    );
  }
  const isClusterLevelGroup = clusterLevelCount > 0;

  return {
    baseIdType: isClusterLevelGroup ? exposureIdentifierType : clusterSubUnit,
    isClusterLevelGroup,
    clusterSubUnit,
  };
}
