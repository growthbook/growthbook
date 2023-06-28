import {
  getBaseIdTypeAndJoins,
  replaceSQLVars,
  expandDenominatorMetrics,
  format,
  replaceCountStar,
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
      getBaseIdTypeAndJoins([
        ["user_id"],
        [],
        ([null, null, null] as unknown) as string[],
      ])
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

    // No dialect
    expect(format(inputSQL)).toEqual(inputSQL);

    // Redshift
    expect(format(inputSQL, "redshift")).toEqual(
      `SELECT\n  *\nFROM\n  mytable`
    );

    // Snowflake flatten function (=>)
    inputSQL = `select * from table(flatten(input => parse_json('{"a":1, "b":[77,88]}'), outer => true)) f`;
    expect(format(inputSQL, "snowflake")).toEqual(
      `select
  *
from
  table (
    flatten(
      input => parse_json('{"a":1, "b":[77,88]}'),
      outer => true
    )
  ) f`
    );

    // Athena lambda syntax (->)
    inputSQL = `SELECT transform(numbers, n -> n * n) as sq`;
    expect(format(inputSQL, "trino")).toEqual(
      `SELECT\n  transform(numbers, n -> n * n) as sq`
    );

    // Postgres JSON syntax
    inputSQL = `SELECT '{"a":[1,2,3],"b":[4,5,6]}'::json#>>'{a,2}' as a,
    '{"a":1,"b":2}'::json->>'b' as b,
    '{"a":1, "b":2}'::jsonb @> '{"b":2}'::jsonb as c,
    '["a", {"b":1}]'::jsonb #- '{1,b}' as d`;
    expect(format(inputSQL, "postgresql")).toEqual(
      `SELECT
  '{"a":[1,2,3],"b":[4,5,6]}'::json #>> '{a,2}' as a,
  '{"a":1,"b":2}'::json ->> 'b' as b,
  '{"a":1, "b":2}'::jsonb @> '{"b":2}'::jsonb as c,
  '["a", {"b":1}]'::jsonb #- '{1,b}' as d`
    );

    // Invalid syntax
    inputSQL = `SELECT (a* as c`;
    expect(format(inputSQL, "mysql")).toEqual(inputSQL);
  });

  it("replaces COUNT(*) correctly", () => {
    expect(replaceCountStar("COuNt(*)", "m.user_id")).toEqual(
      "COUNT(m.user_id)"
    );
    expect(replaceCountStar("count( * )", "m.user_id")).toEqual(
      "COUNT(m.user_id)"
    );
    expect(replaceCountStar("SUM(value) / COUNT( * )", "m.user_id")).toEqual(
      "SUM(value) / COUNT(m.user_id)"
    );
    expect(replaceCountStar("COUNT(value)", "m.user_id")).toEqual(
      "COUNT(value)"
    );
    expect(
      replaceCountStar("SUM(value) / COUNT( * ) + COUNT(*)", "m.user_id")
    ).toEqual("SUM(value) / COUNT(m.user_id) + COUNT(m.user_id)");
  });
});
