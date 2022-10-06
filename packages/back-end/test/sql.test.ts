import {
  getBaseIdTypeAndJoins,
  replaceSQLVars,
  conditionToJavascript,
  getMixpanelPropertyColumn,
  expandDenominatorMetrics,
  format,
} from "../src/util/sql";

describe("backend", () => {
  it("replaces vars in SQL", () => {
    const startDate = new Date(Date.UTC(2021, 0, 5, 10, 20, 15));
    const endDate = new Date(Date.UTC(2022, 1, 9, 11, 30, 12));
    const experimentId = "my-experiment";

    expect(
      replaceSQLVars(
        `SELECT '{{ startDate }}' as full, '{{startYear}}' as year, '{{ startMonth}}' as month, '{{startDay }}' as day`,
        { startDate, endDate }
      )
    ).toEqual(
      "SELECT '2021-01-05 10:20:15' as full, '2021' as year, '01' as month, '05' as day"
    );

    expect(
      replaceSQLVars(`SELECT {{ unknown }}`, { startDate, endDate })
    ).toEqual("SELECT {{ unknown }}");

    expect(
      replaceSQLVars(
        `SELECT '{{ endDate }}' as full, '{{endYear}}' as year, '{{ endMonth}}' as month, '{{endDay }}' as day`,
        { startDate, endDate }
      )
    ).toEqual(
      "SELECT '2022-02-09 11:30:12' as full, '2022' as year, '02' as month, '09' as day"
    );

    expect(
      replaceSQLVars(`time > {{startDateUnix}} && time < {{ endDateUnix }}`, {
        startDate,
        endDate,
      })
    ).toEqual(`time > 1609842015 && time < 1644406212`);

    expect(
      replaceSQLVars(`SELECT * WHERE expid LIKE '{{experimentId}}'`, {
        startDate,
        endDate,
      })
    ).toEqual(`SELECT * WHERE expid LIKE '%'`);

    expect(
      replaceSQLVars(`SELECT * WHERE expid LIKE '{{experimentId}}'`, {
        startDate,
        endDate,
        experimentId,
      })
    ).toEqual(`SELECT * WHERE expid LIKE 'my-experiment'`);
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

  it("detects mixpanel property columns", () => {
    expect(getMixpanelPropertyColumn("abc")).toEqual(`event.properties["abc"]`);

    expect(getMixpanelPropertyColumn("a.b.c")).toEqual(
      `event.properties["a"]["b"]["c"]`
    );

    expect(getMixpanelPropertyColumn("a.[10].c")).toEqual(
      `event.properties["a"][10]["c"]`
    );

    expect(getMixpanelPropertyColumn("event.time")).toEqual(`event.time`);

    expect(getMixpanelPropertyColumn("eventDays")).toEqual(
      `event.properties["eventDays"]`
    );
  });

  it("converts conditions to javascript", () => {
    // Cast left side to string
    expect(
      conditionToJavascript({ column: "v", operator: "=", value: "true" })
    ).toEqual(`event.properties["v"]+'' == "true"`);

    // Use number when right side is numeric
    expect(
      conditionToJavascript({ column: "v", operator: "<", value: "10" })
    ).toEqual(`event.properties["v"]+'' < 10`);

    // Detect numbers correctly
    expect(
      conditionToJavascript({ column: "v", operator: "<", value: "10px" })
    ).toEqual(`event.properties["v"]+'' < "10px"`);

    // Always use strings for equals
    expect(
      conditionToJavascript({ column: "v", operator: "=", value: "10" })
    ).toEqual(`event.properties["v"]+'' == "10"`);

    // Regex
    expect(
      conditionToJavascript({ column: "v", operator: "~", value: "abc.*" })
    ).toEqual(`(event.properties["v"]||"").match(new RegExp("abc.*"))`);

    // Negative regex
    expect(
      conditionToJavascript({ column: "v", operator: "!~", value: "abc.*" })
    ).toEqual(`!(event.properties["v"]||"").match(new RegExp("abc.*"))`);

    // Custom javascript
    expect(
      conditionToJavascript({
        column: "event.time",
        operator: "=>",
        value: "value<5||value>10",
      })
    ).toEqual(`((value) => (value<5||value>10))(event.time)`);
  });

  it("expands denominator metrics", () => {
    const metricMap = new Map<string, { denominator?: string }>(
      Object.entries({
        a: { denominator: "b" },
        b: {},
        c: { denominator: "d" },
        d: { denominator: "c" },
        e: { denominator: "c" },
        f: { denominator: "f" },
        g: { denominator: "h" },
      })
    );

    expect(expandDenominatorMetrics("a", metricMap)).toEqual(["b", "a"]);
    expect(expandDenominatorMetrics("b", metricMap)).toEqual(["b"]);
    expect(expandDenominatorMetrics("c", metricMap)).toEqual(["d", "c"]);
    expect(expandDenominatorMetrics("d", metricMap)).toEqual(["c", "d"]);
    expect(expandDenominatorMetrics("e", metricMap)).toEqual(["d", "c", "e"]);
    expect(expandDenominatorMetrics("f", metricMap)).toEqual(["f"]);
    expect(expandDenominatorMetrics("g", metricMap)).toEqual(["g"]);
    expect(expandDenominatorMetrics("h", metricMap)).toEqual([]);
  });

  it("formats SQL correctly", () => {
    let inputSQL = `SELECT * FROM mytable`;
    expect(format(inputSQL)).toEqual(`SELECT\n  *\nFROM\n  mytable`);

    // Snowflake flatten function (=>)
    inputSQL = `select * from table(flatten(input => parse_json('{"a":1, "b":[77,88]}'), outer => true)) f`;
    expect(format(inputSQL)).toEqual(
      `select
  *
from
  table(
    flatten(
      input => parse_json('{"a":1, "b":[77,88]}'),
      outer => true
    )
  ) f`
    );

    // Athena lambda syntax (->)
    inputSQL = `SELECT transform(numbers, n -> n * n) as sq`;
    expect(format(inputSQL)).toEqual(
      `SELECT\n  transform(numbers, n -> n * n) as sq`
    );
  });
});
