import type { ExperimentSnapshotSettings } from "shared/types/experiment-snapshot";
import { getClusterSubUnit } from "shared/experiments";
import type { ClusterMetricAnalysisLevel } from "shared/experiments";

export interface ClusterMetricGrain {
  baseIdType: string;
  isClusterLevelGroup: boolean;
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
  const clusterSubUnit = getClusterSubUnit(settings);
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

export function getClusterMetricCacheLevel(
  settings: Pick<
    ExperimentSnapshotSettings,
    "isClusterExperiment" | "clusterSubUnitIdentifier" | "clusterLevelMetricIds"
  >,
  metricId: string,
): ClusterMetricAnalysisLevel | undefined {
  if (!getClusterSubUnit(settings)) {
    return undefined;
  }
  return settings.clusterLevelMetricIds?.includes(metricId)
    ? "cluster"
    : "subunit";
}
