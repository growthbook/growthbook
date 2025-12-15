/**
 * Utility functions for testing variance calculations in incremental refresh
 */

/**
 * Calculate sample variance using the formula: (sum_squares - sum^2/n) / (n-1)
 * This is the standard formula for computing variance from sufficient statistics.
 */
export function calculateVariance(sumSquares: number, sum: number, n: number): number {
  if (n <= 1) {
    return 0;
  }
  return (sumSquares - (sum * sum) / n) / (n - 1);
}

/**
 * Calculate standard deviation from variance
 */
export function calculateStdDev(variance: number): number {
  return Math.sqrt(variance);
}

/**
 * Calculate standard error (standard deviation of the mean)
 */
export function calculateStdError(variance: number, n: number): number {
  return Math.sqrt(variance / n);
}

/**
 * Generate mock user-day-level data for testing
 */
export interface UserDayData {
  user_id: string;
  day: string;
  value: number;
}

export function generateUserDayData(
  users: number,
  daysPerUser: number,
  valueGenerator: (userId: number, day: number) => number
): UserDayData[] {
  const data: UserDayData[] = [];
  for (let u = 0; u < users; u++) {
    for (let d = 0; d < daysPerUser; d++) {
      data.push({
        user_id: `u${u}`,
        day: `d${d}`,
        value: valueGenerator(u, d),
      });
    }
  }
  return data;
}

/**
 * Aggregate user-day data to user level (simulating what incremental refresh does)
 */
export interface UserAggregate {
  user_id: string;
  sum: number;
  sum_squares: number;
}

export function aggregateToUserLevel(dailyData: UserDayData[]): UserAggregate[] {
  const userMap = new Map<string, { sum: number; sum_squares: number }>();

  dailyData.forEach((row) => {
    const existing = userMap.get(row.user_id) || { sum: 0, sum_squares: 0 };
    userMap.set(row.user_id, {
      sum: existing.sum + row.value,
      sum_squares: existing.sum_squares + row.value * row.value,
    });
  });

  return Array.from(userMap.entries()).map(([user_id, stats]) => ({
    user_id,
    ...stats,
  }));
}

/**
 * Calculate variance from user-level aggregates
 */
export function calculateVarianceFromAggregates(aggregates: UserAggregate[]): number {
  const totalSum = aggregates.reduce((acc, u) => acc + u.sum, 0);
  const totalSumSquares = aggregates.reduce((acc, u) => acc + u.sum_squares, 0);
  const n = aggregates.length;

  return calculateVariance(totalSumSquares, totalSum, n);
}

/**
 * Calculate expected variance from raw user sums (for comparison)
 */
export function calculateExpectedVariance(userSums: number[]): number {
  const n = userSums.length;
  const sum = userSums.reduce((a, b) => a + b, 0);
  const sumSquares = userSums.reduce((a, b) => a + b * b, 0);

  return calculateVariance(sumSquares, sum, n);
}
