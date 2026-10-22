const DAY_MS = 24 * 60 * 60 * 1000;

export const POPULATION_MEMBERSHIP_WEEKS = 52;
export const POPULATION_MEMBERSHIP_SUMMARY_DAYS = 30;
export const POPULATION_MEMBERSHIP_SUMMARY_POINT_ID = "summary";

export type PopulationMembershipPoint = {
  id: string;
  asOf: Date;
  // Joined is measured from this date.
  prevAsOf: Date;
};

// Membership is calculated through the most recent UTC midnight, so every date
// lines up with daily buckets and the SQL stays the same (and cacheable) all day.
export function getPopulationMembershipAsOf(now: Date = new Date()): Date {
  const asOf = new Date(now);
  asOf.setUTCHours(0, 0, 0, 0);
  return asOf;
}

// The summary point, then one point per week ending at `asOf`, oldest first.
export function getPopulationMembershipPoints(
  asOf: Date,
): PopulationMembershipPoint[] {
  const points: PopulationMembershipPoint[] = [
    {
      id: POPULATION_MEMBERSHIP_SUMMARY_POINT_ID,
      asOf,
      prevAsOf: new Date(
        asOf.getTime() - POPULATION_MEMBERSHIP_SUMMARY_DAYS * DAY_MS,
      ),
    },
  ];
  for (let i = 0; i < POPULATION_MEMBERSHIP_WEEKS; i++) {
    const weeksAgo = POPULATION_MEMBERSHIP_WEEKS - 1 - i;
    const pointAsOf = new Date(asOf.getTime() - weeksAgo * 7 * DAY_MS);
    points.push({
      id: `week_${i}`,
      asOf: pointAsOf,
      prevAsOf: new Date(pointAsOf.getTime() - 7 * DAY_MS),
    });
  }
  return points;
}

// The latest date a membership query reads up to.
export function getPopulationMembershipEndDate(
  points: PopulationMembershipPoint[],
): Date {
  if (!points.length) {
    throw new Error("At least one membership point is required");
  }
  return new Date(Math.max(...points.map((p) => p.asOf.getTime())));
}

export function isWholeUtcDay(date: Date): boolean {
  return date.getTime() % DAY_MS === 0;
}
