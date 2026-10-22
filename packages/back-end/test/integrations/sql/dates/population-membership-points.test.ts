import {
  getPopulationMembershipAsOf,
  getPopulationMembershipEndDate,
  getPopulationMembershipPoints,
  isWholeUtcDay,
  POPULATION_MEMBERSHIP_SUMMARY_POINT_ID,
  POPULATION_MEMBERSHIP_WEEKS,
} from "back-end/src/integrations/sql/dates/population-membership-points";

const asOf = new Date("2026-10-20T00:00:00Z");

describe("getPopulationMembershipAsOf", () => {
  it("rounds down to the most recent UTC midnight", () => {
    expect(
      getPopulationMembershipAsOf(new Date("2026-10-20T15:42:10Z")),
    ).toEqual(new Date("2026-10-20T00:00:00Z"));
  });
});

describe("getPopulationMembershipPoints", () => {
  const points = getPopulationMembershipPoints(asOf);

  it("starts with a summary point compared against 30 days earlier", () => {
    expect(points[0]).toEqual({
      id: POPULATION_MEMBERSHIP_SUMMARY_POINT_ID,
      asOf,
      prevAsOf: new Date("2026-09-20T00:00:00Z"),
    });
  });

  it("has one point per week, oldest first, each compared with the week before", () => {
    const weeks = points.slice(1);
    expect(weeks).toHaveLength(POPULATION_MEMBERSHIP_WEEKS);
    expect(weeks[weeks.length - 1]).toEqual({
      id: `week_${POPULATION_MEMBERSHIP_WEEKS - 1}`,
      asOf,
      prevAsOf: new Date("2026-10-13T00:00:00Z"),
    });
    expect(weeks[0].asOf).toEqual(
      new Date(asOf.getTime() - 51 * 7 * 24 * 60 * 60 * 1000),
    );
  });
});

describe("getPopulationMembershipEndDate", () => {
  it("is the latest point's date", () => {
    expect(
      getPopulationMembershipEndDate(getPopulationMembershipPoints(asOf)),
    ).toEqual(asOf);
  });

  it("throws without any points", () => {
    expect(() => getPopulationMembershipEndDate([])).toThrow(
      "At least one membership point is required",
    );
  });
});

describe("isWholeUtcDay", () => {
  it("is true only at UTC midnight", () => {
    expect(isWholeUtcDay(asOf)).toBe(true);
    expect(isWholeUtcDay(new Date("2026-10-20T00:00:01Z"))).toBe(false);
  });
});
