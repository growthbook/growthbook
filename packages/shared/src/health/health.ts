import { ExperimentSnapshotInterface } from "shared/types/experiment-snapshot";
import { SafeRolloutSnapshotInterface } from "../validators/safe-rollout-snapshot.js";
import { ExperimentType } from "../validators/experiments.js";

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

export function getSRMValue(
  experimentType: ExperimentType,
  snapshot: ExperimentSnapshotInterface,
): number | undefined {
  switch (experimentType) {
    case "multi-armed-bandit":
      // get SRM from bandit result if available (only old bandit snapshots have SRM
      // on the banditResult object)
      return (
        snapshot.banditResult?.srm ?? snapshot.health?.traffic?.overall?.srm
      );

    case "holdout":
    case "standard": {
      const healthQuerySRM = snapshot.health?.traffic?.overall?.srm;

      if (healthQuerySRM !== undefined) {
        return healthQuerySRM;
      }
      // fall back to main results SRM for no dimension split snapshots
      // and without health query SRM
      // if no dimension && only one overall result (e.g. no dim splits)
      if (
        snapshot.type === "standard" &&
        snapshot.analyses?.[0]?.results?.length === 1
      ) {
        return snapshot.analyses?.[0]?.results?.[0]?.srm;
      }
      return undefined;
    }

    default: {
      const _exhaustiveCheck: never = experimentType;
      // eslint-disable-next-line no-console
      console.error(
        `Unknown experiment type for SRM: ${_exhaustiveCheck}. snapshotId: ${snapshot.id}`,
      );
      return undefined;
    }
  }
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
