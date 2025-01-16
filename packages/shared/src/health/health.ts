import {
  DEFAULT_MULTIPLE_EXPOSURES_MINIMUM_COUNT,
  DEFAULT_MULTIPLE_EXPOSURES_MINIMUM_PERCENT,
  DEFAULT_SRM_MIN_COUNT_PER_VARIATION,
} from "../constants";

type MultipleExposureHealthStatus =
  | "not-enough-traffic"
  | "healthy"
  | "unhealthy";

type MultipleExposureHealthData = {
  status: MultipleExposureHealthStatus;
  rawPercent: number;
};

/**
 * Returns the health status for Multiple Exposures in an experiment
 *
 * @param multipleExposureCount - Number of units exposed to multiple variations
 * @param totalUnitCount - Total number of units exposed to any variation
 * @param minCountThreshold - Minimum number of multiple exposures required to be considered significant
 * @param minPercentThreshold - Minimum percentage of multiple exposures required to be considered unhealthy
 */
export const getMultipleExposureHealthData = ({
  multipleExposureCount,
  totalUnitCount,
  minCountThreshold,
  minPercentThreshold,
}: {
  multipleExposureCount: number;
  totalUnitCount: number;
  minCountThreshold?: number;
  minPercentThreshold?: number;
}): MultipleExposureHealthData => {
  const multipleExposurePercent = multipleExposureCount / totalUnitCount;

  const hasEnoughData =
    multipleExposureCount >=
    (minCountThreshold || DEFAULT_MULTIPLE_EXPOSURES_MINIMUM_COUNT);

  const isUnhealthy =
    multipleExposurePercent >=
    (minPercentThreshold || DEFAULT_MULTIPLE_EXPOSURES_MINIMUM_PERCENT);

  const data = {
    rawPercent: multipleExposurePercent,
  };

  if (!hasEnoughData) {
    // TODO: The previous logic from MultipleExposuresCard returned "healthy" but maybe we should return "not-enough-traffic" ?
    return {
      status: "healthy",
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
};

export type SRMHealthStatus = "not-enough-traffic" | "healthy" | "unhealthy";

export const getSRMHealthData = ({
  srm,
  numVariations,
  srmThreshold,
  totalUsers,
}: {
  srm: number;
  numVariations: number;
  srmThreshold: number;
  totalUsers: number;
}): SRMHealthStatus => {
  // TODO: Add Bandit check and use DEFAULT_BANDIT_SRM_MIN_COUNT_PER_VARIATION
  const totalMinCount = DEFAULT_SRM_MIN_COUNT_PER_VARIATION * numVariations;

  if (totalUsers < totalMinCount) {
    return "not-enough-traffic";
  } else if (srm < srmThreshold) {
    return "unhealthy";
  } else {
    return "healthy";
  }
};
