import {
  getPopulationMembershipPoints,
  POPULATION_MEMBERSHIP_WEEKS,
} from "back-end/src/integrations/sql/dates/population-membership-points";
import { processPopulationMembershipRows } from "back-end/src/integrations/sql/processing/process-population-membership-rows";

const asOf = new Date("2026-10-20T00:00:00Z");

describe("processPopulationMembershipRows", () => {
  const points = getPopulationMembershipPoints(asOf);

  it("reads the summary and weekly counts", () => {
    const result = processPopulationMembershipRows(points, [
      {
        point_id: "summary",
        members_count: "120",
        joined_count: 30,
        left_count: 10,
      },
      {
        point_id: "week_51",
        members_count: 120,
        joined_count: 8,
        left_count: 2,
      },
    ]);

    expect(result.asOf).toBe(asOf.toISOString());
    expect(result.summary).toEqual({
      members: 120,
      joined: 30,
      left: 10,
      comparedTo: "2026-09-20T00:00:00.000Z",
    });
    expect(result.series[result.series.length - 1]).toEqual({
      date: asOf.toISOString(),
      members: 120,
      joined: 8,
      left: 2,
    });
  });

  it("fills points without a row with zeros", () => {
    const result = processPopulationMembershipRows(points, []);

    expect(result.series).toHaveLength(POPULATION_MEMBERSHIP_WEEKS);
    expect(result.series[0]).toEqual({
      date: points[1].asOf.toISOString(),
      members: 0,
      joined: 0,
      left: 0,
    });
  });
});
