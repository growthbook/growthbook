import { ExperimentSnapshotInterface } from "shared/types/experiment-snapshot";
import { SafeRolloutSnapshotInterface } from "../validators/safe-rollout-snapshot";

type MultipleExposureHealthStatus =
  | "not-enough-traffic"
  | "healthy"
  | "unhealthy";

export type SRMHealthStatus = "not-enough-traffic" | "healthy" | "unhealthy";

type MultipleExposureHealthData = {
  status: MultipleExposureHealthStatus;
  rawDecimal: number;
};

/**
 * Returns the health status for Multiple Exposures in an experiment
 *
 * @param multipleExposuresCount - Number of users exposed to multiple variations
 * @param totalUsersCount - Total number of users exposed to any variation
 * @param minCountThreshold - Minimum number of total users required to be considered enough data
 * @param minPercentThreshold - Minimum percentage of multiple exposures required to be considered unhealthy
 */
export function getMultipleExposureHealthData({
  multipleExposuresCount,
  totalUsersCount,
  minCountThreshold,
  minPercentThreshold,
}: {
  multipleExposuresCount: number;
  totalUsersCount: number;
  minCountThreshold: number;
  minPercentThreshold: number;
}): MultipleExposureHealthData {
  const multipleExposureDecimal = multipleExposuresCount / totalUsersCount;

  const hasEnoughData = totalUsersCount >= minCountThreshold;

  const isUnhealthy = multipleExposureDecimal >= minPercentThreshold;

  const data = {
    rawDecimal: multipleExposureDecimal,
  };

  if (!hasEnoughData) {
    return {
      status: "not-enough-traffic",
      ...data,
    };
  } else if (isUnhealthy) {
    return {
      status: "unhealthy",
      ...data,
    };
  } else {
    return {
      status: "healthy",
      ...data,
    };
  }
}

/**
 * Health status for a cluster experiment check that removes some clusters or
 * sub-units from results (mixed assignment, sub-units in several clusters).
 */
export function getClusterIssueHealthData({
  affectedCount,
  totalCount,
  minPercentThreshold,
}: {
  affectedCount: number;
  totalCount: number;
  minPercentThreshold: number;
}): MultipleExposureHealthData {
  if (totalCount <= 0) {
    return { status: "not-enough-traffic", rawDecimal: 0 };
  }
  const rawDecimal = affectedCount / totalCount;
  return {
    status:
      affectedCount > 0 && rawDecimal >= minPercentThreshold
        ? "unhealthy"
        : "healthy",
    rawDecimal,
  };
}

/**
 * Health status for whether a cluster experiment has enough clusters in every
 * variation for its results to be reliable. Reports the smallest variation.
 */
export function getClusterCountHealthData({
  clustersPerVariation,
  minClustersPerVariation,
}: {
  clustersPerVariation: number[];
  minClustersPerVariation: number;
}): {
  status: "not-enough-traffic" | "healthy" | "unhealthy";
  smallestVariationIndex: number;
  smallestCount: number;
} {
  if (!clustersPerVariation.some((n) => n > 0)) {
    return {
      status: "not-enough-traffic",
      smallestVariationIndex: -1,
      smallestCount: 0,
    };
  }
  const smallestCount = Math.min(...clustersPerVariation);
  return {
    status: smallestCount < minClustersPerVariation ? "unhealthy" : "healthy",
    smallestVariationIndex: clustersPerVariation.indexOf(smallestCount),
    smallestCount,
  };
}

/**
 * Returns the health status for Sample Ratio Mismatch (SRM) in an experiment
 *
 * @param srm - The SRM p-value calculated for the experiment
 * @param numOfVariations - Number of variations in the experiment
 * @param totalUsersCount - Total number of users across all variations
 * @param srmThreshold - P-value threshold below which SRM is considered unhealthy
 * @param minUsersPerVariation - Minimum number of users required per variation
 * @returns SRMHealthStatus - The health status: 'healthy', 'unhealthy', or 'not-enough-traffic'
 */
export function getSRMHealthData({
  srm,
  numOfVariations,
  totalUsersCount,
  srmThreshold,
  minUsersPerVariation,
}: {
  srm: number;
  numOfVariations: number;
  totalUsersCount: number;
  srmThreshold: number;
  minUsersPerVariation: number;
}): SRMHealthStatus {
  const minUsersCount = numOfVariations * minUsersPerVariation;

  if (totalUsersCount < minUsersCount) {
    return "not-enough-traffic";
  } else if (srm < srmThreshold) {
    return "unhealthy";
  } else {
    return "healthy";
  }
}

/**
 * SRM lookup for multi-armed-bandit experiments. Reads only top-level
 * snapshot fields, so callers that only have a status summary (e.g.
 * `SnapshotStatusSummary`) can use it without paying for the heavy
 * analyses fetch. Old bandit snapshots stored SRM on `banditResult`;
 * newer ones surface it via the dedicated health query.
 */
export function getBanditSRMValue(
  snapshot: Pick<ExperimentSnapshotInterface, "banditResult" | "health">,
): number | undefined {
  return snapshot.banditResult?.srm ?? snapshot.health?.traffic?.overall?.srm;
}

// Only standard snapshots with a single non-dimension-split result have a
// meaningful overall result to fall back on; holdouts and dimension splits don't.
function getStandardOverallResultForHealthFallback(
  snapshot: ExperimentSnapshotInterface,
) {
  return snapshot.type === "standard" &&
    snapshot.analyses?.[0]?.results?.length === 1
    ? snapshot.analyses?.[0]?.results?.[0]
    : undefined;
}

// Cluster experiments randomize on the cluster, so SRM is tested on cluster
// counts rather than the sub-unit counts in `traffic`.
export function getExperimentSRMTraffic(
  snapshot: Pick<ExperimentSnapshotInterface, "settings" | "health">,
) {
  const clusterTraffic = snapshot.health?.clusterTraffic;
  if (
    snapshot.settings?.isClusterExperiment &&
    clusterTraffic &&
    !clusterTraffic.error
  ) {
    return clusterTraffic;
  }
  return snapshot.health?.traffic;
}

/**
 * SRM lookup for standard or holdout experiments. Requires the full
 * snapshot because the fallback path reads `analyses[0].results[0].srm`
 * when the dedicated health query hasn't run; passing a narrowed
 * snapshot summary here would silently return `undefined` for snapshots
 * that depend on the fallback, so the type system rules that out.
 */
export function getExperimentSRMValue(
  snapshot: ExperimentSnapshotInterface,
): number | undefined {
  const healthQuerySRM = getExperimentSRMTraffic(snapshot)?.overall?.srm;
  if (healthQuerySRM !== undefined) {
    return healthQuerySRM;
  }
  return getStandardOverallResultForHealthFallback(snapshot)?.srm;
}

/**
 * Per-variation unit counts from the same source as `getExperimentSRMValue`:
 * the dedicated health traffic query, falling back to the overall analysis
 * result for standard snapshots.
 */
export function getExperimentVariationUnitsFromHealth(
  snapshot: ExperimentSnapshotInterface,
): number[] | undefined {
  const healthUnits = snapshot.health?.traffic?.overall?.variationUnits;
  if (healthUnits?.length) {
    return healthUnits;
  }
  return getStandardOverallResultForHealthFallback(snapshot)?.variations?.map(
    (v) => v.users,
  );
}

// Per-variation unit counts the SRM p-value was computed on.
export function getExperimentSRMVariationUnits(
  snapshot: ExperimentSnapshotInterface,
): number[] | undefined {
  const units = getExperimentSRMTraffic(snapshot)?.overall?.variationUnits;
  if (units?.length) {
    return units;
  }
  return getExperimentVariationUnitsFromHealth(snapshot);
}

// Units exposed across all variations, per the snapshot's health data;
// undefined when the snapshot recorded none.
export function getExperimentTotalUnitsFromHealth(
  snapshot: ExperimentSnapshotInterface,
): number | undefined {
  const units = getExperimentVariationUnitsFromHealth(snapshot);
  return units?.length ? units.reduce((sum, n) => sum + n, 0) : undefined;
}

export function getSafeRolloutSRMValue(
  safeRolloutSnapshot: SafeRolloutSnapshotInterface,
): number | undefined {
  const healthQuerySRM = safeRolloutSnapshot.health?.traffic?.overall?.srm;
  if (healthQuerySRM !== undefined) {
    return healthQuerySRM;
  }

  // fall back to main results SRM for no dimension split snapshots
  // and without health query SRM
  // if no dimension && only one overall result (e.g. no dim splits)
  if (safeRolloutSnapshot.analyses?.[0]?.results?.length === 1) {
    return safeRolloutSnapshot.analyses?.[0]?.results?.[0]?.srm;
  }
  return undefined;
}
