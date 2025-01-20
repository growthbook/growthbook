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
 * @param minCountThreshold - Minimum number of multiple exposures required to be considered significant
 * @param minPercentThreshold - Minimum percentage of multiple exposures required to be considered unhealthy
 */
export const getMultipleExposureHealthData = ({
  multipleExposuresCount,
  totalUsersCount,
  minCountThreshold,
  minPercentThreshold,
}: {
  multipleExposuresCount: number;
  totalUsersCount: number;
  minCountThreshold: number;
  minPercentThreshold: number;
}): MultipleExposureHealthData => {
  const multipleExposureDecimal = multipleExposuresCount / totalUsersCount;

  const hasEnoughData = multipleExposuresCount >= minCountThreshold;

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
};

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
export const getSRMHealthData = ({
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
}): SRMHealthStatus => {
  const minUsersCount = numOfVariations * minUsersPerVariation;

  if (totalUsersCount < minUsersCount) {
    return "not-enough-traffic";
  } else if (srm < srmThreshold) {
    return "unhealthy";
  } else {
    return "healthy";
  }
};
