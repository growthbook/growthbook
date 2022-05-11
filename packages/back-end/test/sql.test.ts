import { getBaseIdTypeAndJoins, replaceDateVars } from "../src/util/sql";

describe("backend", () => {
  it("replaces vars in SQL", () => {
    const start = new Date(Date.UTC(2021, 0, 5, 10, 20, 15));
    const end = new Date(Date.UTC(2022, 1, 9, 11, 30, 12));

    expect(
      replaceDateVars(
        `SELECT '{{ startDate }}' as full, '{{startYear}}' as year, '{{ startMonth}}' as month, '{{startDay }}' as day`,
        start,
        end
      )
    ).toEqual(
      "SELECT '2021-01-05 10:20:15' as full, '2021' as year, '01' as month, '05' as day"
    );

    expect(replaceDateVars(`SELECT {{ unknown }}`, start, end)).toEqual(
      "SELECT {{ unknown }}"
    );

    expect(
      replaceDateVars(
        `SELECT '{{ endDate }}' as full, '{{endYear}}' as year, '{{ endMonth}}' as month, '{{endDay }}' as day`,
        start,
        end
      )
    ).toEqual(
      "SELECT '2022-02-09 11:30:12' as full, '2022' as year, '02' as month, '09' as day"
    );

    expect(
      replaceDateVars(
        `time > {{startDateUnix}} && time < {{ endDateUnix }}`,
        start,
        end
      )
    ).toEqual(`time > 1609842015 && time < 1644406212`);
  });

  it("determines identifier joins correctly", () => {
    // Simple case
    expect(getBaseIdTypeAndJoins([["anonymous_id"], ["user_id"]])).toEqual({
      baseIdType: "anonymous_id",
      joinsRequired: ["user_id"],
    });

    // Don't need a join
    expect(
      getBaseIdTypeAndJoins([["anonymous_id"], ["user_id", "anonymous_id"]])
    ).toEqual({
      baseIdType: "anonymous_id",
      joinsRequired: [],
    });

    // Chooses the most common id as the base
    expect(
      getBaseIdTypeAndJoins([
        ["id1", "id2", "id3", "id4", "id5"],
        ["id2", "id3", "id4", "id5"],
        ["id3", "id4"],
        ["id4", "id5"],
      ])
    ).toEqual({
      baseIdType: "id4",
      joinsRequired: [],
    });

    // Ignores empty objects
    expect(
      getBaseIdTypeAndJoins([["user_id"], [], [null, null, null]])
    ).toEqual({
      baseIdType: "user_id",
      joinsRequired: [],
    });

    // Multiple joins required
    expect(
      getBaseIdTypeAndJoins([
        ["id1", "id2"],
        ["id2", "id3"],
        ["id4", "id5"],
        ["id6", "id7"],
        ["id8"],
      ])
    ).toEqual({
      baseIdType: "id2",
      joinsRequired: ["id8", "id4", "id6"],
    });

    // Forced base id type
    expect(
      getBaseIdTypeAndJoins(
        [["anonymous_id"], ["user_id"], ["user_id"]],
        "anonymous_id"
      )
    ).toEqual({
      baseIdType: "anonymous_id",
      joinsRequired: ["user_id"],
    });
  });
});
