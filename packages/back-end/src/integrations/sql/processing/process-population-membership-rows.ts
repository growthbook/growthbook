import type { PopulationMembershipResult } from "shared/validators";
import {
  POPULATION_MEMBERSHIP_SUMMARY_POINT_ID,
  PopulationMembershipPoint,
} from "back-end/src/integrations/sql/dates/population-membership-points";

function parseCount(value: unknown): number {
  const count = typeof value === "string" ? parseFloat(value) : value;
  return typeof count === "number" && !Number.isNaN(count) ? count : 0;
}

// Points with no members return no row, so they're filled with 0.
export function processPopulationMembershipRows(
  points: PopulationMembershipPoint[],
  rows: Record<string, unknown>[],
): PopulationMembershipResult {
  const rowsByPoint = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    if (typeof row["point_id"] === "string") {
      rowsByPoint.set(row["point_id"], row);
    }
  }
  const counts = (id: string) => {
    const row = rowsByPoint.get(id);
    return {
      members: parseCount(row?.["members_count"]),
      joined: parseCount(row?.["joined_count"]),
      left: parseCount(row?.["left_count"]),
    };
  };

  const summary = points.find(
    (p) => p.id === POPULATION_MEMBERSHIP_SUMMARY_POINT_ID,
  );
  if (!summary) {
    throw new Error("Membership points are missing the summary point");
  }

  return {
    asOf: summary.asOf.toISOString(),
    summary: {
      ...counts(summary.id),
      comparedTo: summary.prevAsOf.toISOString(),
    },
    series: points
      .filter((p) => p.id !== POPULATION_MEMBERSHIP_SUMMARY_POINT_ID)
      .map((p) => ({ date: p.asOf.toISOString(), ...counts(p.id) })),
  };
}
