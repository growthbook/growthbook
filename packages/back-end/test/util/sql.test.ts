import { format } from "shared/sql";
import {
  getBaseIdTypeAndJoins,
  compileSqlTemplate,
  expandDenominatorMetrics,
  replaceCountStar,
  determineColumnTypes,
  getHost,
  formatAsync,
} from "back-end/src/util/sql";

describe("backend", () => {
  describe("compileSqlTemplate", () => {
    const startDate = new Date(Date.UTC(2021, 0, 5, 10, 20, 15));
    const endDate = new Date(Date.UTC(2022, 1, 9, 11, 30, 12));
    const experimentId = "my-experiment";

    it("replaces start date vars", () => {
      expect(
        compileSqlTemplate(
          `SELECT '{{ startDate }}' as full, '{{startYear}}' as year, '{{ startMonth}}' as month, '{{startDay }}' as day`,
          { startDate, endDate },
        ),
      ).toEqual(
        "SELECT '2021-01-05 10:20:15' as full, '2021' as year, '01' as month, '05' as day",
      );
    });

    it("replaces valueColumn and eventName and phase", () => {
      expect(
        compileSqlTemplate(
          `SELECT {{valueColumn}} as value from db.{{eventName}} where phase = '{{phase.index}}'`,
          {
            startDate,
            endDate,
            phase: { index: "0" },
            templateVariables: {
              eventName: "purchase",
              valueColumn: "amount",
            },
          },
        ),
      ).toEqual("SELECT amount as value from db.purchase where phase = '0'");
    });

    it("replaces nested template variables", () => {
      expect(
        compileSqlTemplate(
          `SELECT {{customFields.foo}} as value from db.{{customFields.bar}}`,
          {
            startDate,
            endDate,
            customFields: { foo: "amount", bar: "purchase" },
          },
        ),
      ).toEqual("SELECT amount as value from db.purchase");
    });

    it("throws error when eventName is in sql but is not set", () => {
      expect(() => {
        compileSqlTemplate(`SELECT {{ snakecase eventName }}`, {
          startDate,
          endDate,
        });
      }).toThrowError(
        "Error compiling SQL template: You must set eventName first.",
      );
    });

    it("throws error if value colun is in sql but is not set.", () => {
      expect(() => {
        compileSqlTemplate(`SELECT {{ snakecase valueColumn }} as value`, {
          startDate,
          endDate,
        });
      }).toThrowError(
        "Error compiling SQL template: You must set valueColumn first.",
      );
    });

    it("throws error listing available variables when using an unknown nested variable", () => {
      expect(() => {
        compileSqlTemplate(`SELECT {{ customFields.unknown }}`, {
          startDate,
          endDate,
          customFields: { foo: "bar" },
        });
      }).toThrowError(
        "Unknown variable: unknown. Available variables: customFields, phase, startDateUnix, startDateISO, startDate, startYear, startMonth, startDay, endDateUnix, endDateISO, endDate, endYear, endMonth, endDay, experimentId",
      );
    });

    it("throws error when using an unknown nested variable with a helper", () => {
      expect(() => {
        compileSqlTemplate(`SELECT {{ snakecase customFields.unknown }}`, {
          startDate,
          endDate,
          customFields: { foo: "bar" },
        });
      }).toThrowError(
        "Error compiling SQL template: Missing variable passed to helper 'snakecase'",
      );
    });

    it("throws error listing available variables when using an unknown one", () => {
      expect(() => {
        compileSqlTemplate(`SELECT {{ unknown }}`, {
          startDate,
          endDate,
        });
      }).toThrowError(
        "Unknown variable: unknown. Available variables: customFields, phase, startDateUnix, startDateISO, startDate, startYear, startMonth, startDay, endDateUnix, endDateISO, endDate, endYear, endMonth, endDay, experimentId",
      );
    });

    it("throws error when using an unknown variable with a helper", () => {
      expect(() => {
        compileSqlTemplate(`SELECT {{ snakecase unknown }}`, {
          startDate,
          endDate,
        });
      }).toThrowError(
        "Error compiling SQL template: Missing variable passed to helper 'snakecase'",
      );
    });

    it("does not throw when checking for existence of a variable that is not used", () => {
      expect(
        compileSqlTemplate(
          `SELECT * WHERE 1=1{{#if unknown}} AND foo = '{{unknown}}' {{/if}}`,
          {
            startDate,
            endDate,
          },
        ),
      ).toEqual("SELECT * WHERE 1=1");
    });

    it("compiles and runs a helper function", () => {
      expect(
        compileSqlTemplate(`SELECT {{lowercase "HELLO"}}`, {
          startDate,
          endDate,
        }),
      ).toEqual("SELECT hello");
    });

    it("throws an error listing out all helper functions when given an unknown one.", () => {
      expect(() => {
        compileSqlTemplate(`SELECT {{unknownFunc "HELLO"}}`, {
          startDate,
          endDate,
        });
      }).toThrowError("Unknown helper: unknownFunc. Available helpers:");
    });

    it("evaluates and replaces startDateISO variable with appropriate format when using date helper function.", () => {
      expect(
        compileSqlTemplate(
          `SELECT {{date startDateISO "hh"}} as hour, {{date startDateISO "z"}} as tz`,
          {
            startDate,
            endDate,
          },
        ),
      ).toEqual("SELECT 10 as hour, UTC as tz");
    });

    it("replaces end date variables", () => {
      expect(
        compileSqlTemplate(
          `SELECT '{{ endDate }}' as full, '{{endYear}}' as year, '{{ endMonth}}' as month, '{{endDay }}' as day`,
          { startDate, endDate },
        ),
      ).toEqual(
        "SELECT '2022-02-09 11:30:12' as full, '2022' as year, '02' as month, '09' as day",
      );
    });

    it("replaces time stamp variables", () => {
      expect(
        compileSqlTemplate(
          `time > {{startDateUnix}} && time < {{ endDateUnix }}`,
          {
            startDate,
            endDate,
          },
        ),
      ).toEqual(`time > 1609842015 && time < 1644406212`);
    });

    it("replaces experimentId variable with % when experiment id is missing.", () => {
      expect(
        compileSqlTemplate(`SELECT * WHERE expid LIKE '{{experimentId}}'`, {
          startDate,
          endDate,
        }),
      ).toEqual(`SELECT * WHERE expid LIKE '%'`);
    });

    it("replaces experimentId when it is set.", () => {
      expect(
        compileSqlTemplate(`SELECT * WHERE expid LIKE '{{experimentId}}'`, {
          startDate,
          endDate,
          experimentId,
        }),
      ).toEqual(`SELECT * WHERE expid LIKE 'my-experiment'`);
    });
  });

  describe("getBaseIdTypeAndJoins", () => {
    it("determines identifier joins for a simple case correctly", () => {
      expect(getBaseIdTypeAndJoins([["anonymous_id"], ["user_id"]])).toEqual({
        baseIdType: "anonymous_id",
        joinsRequired: ["user_id"],
      });
    });

    it("correctly determines when no joins are required", () => {
      expect(
        getBaseIdTypeAndJoins([["anonymous_id"], ["user_id", "anonymous_id"]]),
      ).toEqual({
        baseIdType: "anonymous_id",
        joinsRequired: [],
      });
    });

    it("chooses the most common id as the base", () => {
      expect(
        getBaseIdTypeAndJoins([
          ["id1", "id2", "id3", "id4", "id5"],
          ["id2", "id3", "id4", "id5"],
          ["id3", "id4"],
          ["id4", "id5"],
        ]),
      ).toEqual({
        baseIdType: "id4",
        joinsRequired: [],
      });
    });

    it("ignores empty objects", () => {
      expect(
        getBaseIdTypeAndJoins([
          ["user_id"],
          [],
          [null, null, null] as unknown as string[],
        ]),
      ).toEqual({
        baseIdType: "user_id",
        joinsRequired: [],
      });
    });

    it("correctly determines when multiple joins are required", () => {
      expect(
        getBaseIdTypeAndJoins([
          ["id1", "id2"],
          ["id2", "id3"],
          ["id4", "id5"],
          ["id6", "id7"],
          ["id8"],
        ]),
      ).toEqual({
        baseIdType: "id2",
        joinsRequired: ["id8", "id4", "id6"],
      });
    });

    it("uses id frequency count to find more efficient joins", () => {
      expect(
        getBaseIdTypeAndJoins([
          ["id1", "id2"],
          ["id1", "id3"],
          ["id2", "id3"],
          ["id4", "id3"],
          // to make id 1 most common
          ["id1", "id8"],
          ["id1", "id9"],
        ]),
      ).toEqual({
        baseIdType: "id1",
        joinsRequired: ["id3"],
      });
    });

    it("determines when there is a forced base id type", () => {
      expect(
        getBaseIdTypeAndJoins(
          [["anonymous_id"], ["user_id"], ["user_id"]],
          "anonymous_id",
        ),
      ).toEqual({
        baseIdType: "anonymous_id",
        joinsRequired: ["user_id"],
      });
    });
  });

  describe("expandDenominatorMetrics", () => {
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
        }),
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
  });

  describe("format", () => {
    it("formats SQL correctly when no dialect is selected", () => {
      const inputSQL = `SELECT * FROM mytable`;

      expect(format(inputSQL)).toEqual(inputSQL);
    });

    it("formats SQL correctly when a redshift is selected", () => {
      const inputSQL = `SELECT * FROM mytable`;
      expect(format(inputSQL, "redshift")).toEqual(
        `SELECT\n  *\nFROM\n  mytable`,
      );
    });

    it("formats correctly when using Snowflake flatten function (=>)", () => {
      const inputSQL = `select * from table(flatten(input => parse_json('{"a":1, "b":[77,88]}'), outer => true)) f`;
      expect(format(inputSQL, "snowflake")).toEqual(
        `select
  *
from
  table (
    flatten(
      input => parse_json('{"a":1, "b":[77,88]}'),
      outer => true
    )
  ) f`,
      );
    });

    it("formats correctly when using Athena lambda syntax (->)", () => {
      const inputSQL = `SELECT transform(numbers, n -> n * n) as sq`;
      expect(format(inputSQL, "trino")).toEqual(
        `SELECT\n  transform(numbers, n -> n * n) as sq`,
      );
    });

    it("formats Postgres JSON syntax correctly", () => {
      const inputSQL = `SELECT '{"a":[1,2,3],"b":[4,5,6]}'::json#>>'{a,2}' as a,
    '{"a":1,"b":2}'::json->>'b' as b,
    '{"a":1, "b":2}'::jsonb @> '{"b":2}'::jsonb as c,
    '["a", {"b":1}]'::jsonb #- '{1,b}' as d`;
      expect(format(inputSQL, "postgresql")).toEqual(
        `SELECT
  '{"a":[1,2,3],"b":[4,5,6]}'::json #>> '{a,2}' as a,
  '{"a":1,"b":2}'::json ->> 'b' as b,
  '{"a":1, "b":2}'::jsonb @> '{"b":2}'::jsonb as c,
  '["a", {"b":1}]'::jsonb #- '{1,b}' as d`,
      );
    });

    it("ignores invalid syntax", () => {
      const inputSQL = `SELECT (a* as c`;
      expect(format(inputSQL, "mysql")).toEqual(inputSQL);
    });
  });

  describe("replaceCountStar", () => {
    it("can handle mixed casing", () => {
      expect(replaceCountStar("COuNt(*)", "m.user_id")).toEqual(
        "COUNT(m.user_id)",
      );
    });

    it("can handle spaces around the star", () => {
      expect(replaceCountStar("count( * )", "m.user_id")).toEqual(
        "COUNT(m.user_id)",
      );
    });

    it("can replace it anywhere in an expression", () => {
      expect(replaceCountStar("SUM(value) / COUNT( * )", "m.user_id")).toEqual(
        "SUM(value) / COUNT(m.user_id)",
      );
    });

    it("ignores COUNT that is not a count of *", () => {
      expect(replaceCountStar("COUNT(value)", "m.user_id")).toEqual(
        "COUNT(value)",
      );
    });

    it("replaces multiple occurrences", () => {
      expect(
        replaceCountStar("SUM(value) / COUNT( * ) + COUNT(*)", "m.user_id"),
      ).toEqual("SUM(value) / COUNT(m.user_id) + COUNT(m.user_id)");
    });
  });

  describe("determineColumns", () => {
    it("can determine columns and types from result", () => {
      expect(
        determineColumnTypes(
          [
            {
              num: 123,
              str: "hello",
              dateStr: "2023-01-01 00:00:00",
              dateObj: new Date(),
              bool: false,
              other: ["testing"],
              empty: null,
            },
          ],
          new Map(),
        ),
      ).toEqual([
        { column: "num", datatype: "number" },
        { column: "str", datatype: "string" },
        { column: "dateStr", datatype: "date" },
        { column: "dateObj", datatype: "date" },
        { column: "bool", datatype: "boolean" },
        { column: "other", datatype: "other" },
        { column: "empty", datatype: "" },
      ]);
    });

    it("can determine JSON field keys and values", () => {
      expect(
        determineColumnTypes(
          [
            {
              x: JSON.stringify({
                a: 123,
                b: "hello",
                c: false,
                d: null,
                e: null,
              }),
            },
            {
              x: JSON.stringify({ d: 123, f: "foo" }),
            },
          ],
          new Map(),
        ),
      ).toEqual([
        {
          column: "x",
          datatype: "json",
          jsonFields: {
            a: { datatype: "number" },
            b: { datatype: "string" },
            c: { datatype: "boolean" },
            d: { datatype: "number" },
            f: { datatype: "string" },
          },
        },
      ]);
    });

    it("can skip over null values", () => {
      expect(
        determineColumnTypes(
          [
            {
              col: null,
            },
            {
              col: 123,
            },
          ],
          new Map(),
        ),
      ).toEqual([{ column: "col", datatype: "number" }]);
    });

    it("detects JSON objects in addition to strings", () => {
      expect(
        determineColumnTypes(
          [
            {
              x: { a: 123, b: "hello", c: false, d: null, e: null },
            },
            {
              x: { d: 123, f: "foo" },
            },
          ],
          new Map(),
        ),
      ).toEqual([
        {
          column: "x",
          datatype: "json",
          jsonFields: {
            a: { datatype: "number" },
            b: { datatype: "string" },
            c: { datatype: "boolean" },
            d: { datatype: "number" },
            f: { datatype: "string" },
          },
        },
      ]);
    });

    it("detects Date objects as datatype date", () => {
      expect(
        determineColumnTypes(
          [
            {
              d: new Date(),
            },
          ],
          new Map(),
        ),
      ).toEqual([{ column: "d", datatype: "date" }]);
    });

    it("detects other non-plain objects as 'other'", () => {
      expect(
        determineColumnTypes(
          [
            {
              d: new Map(),
            },
          ],
          new Map(),
        ),
      ).toEqual([{ column: "d", datatype: "other" }]);
    });

    it("refines string type to json when values are JSON strings", () => {
      expect(
        determineColumnTypes(
          [
            {
              payload: JSON.stringify({ a: 1, b: "x" }),
            },
            {
              payload: JSON.stringify({ b: "y", c: false }),
            },
          ],
          new Map([["payload", "string"]]),
        ),
      ).toEqual([
        {
          column: "payload",
          datatype: "json",
          jsonFields: {
            a: { datatype: "number" },
            b: { datatype: "string" },
            c: { datatype: "boolean" },
          },
        },
      ]);
    });
  });
});

describe("getHost", () => {
  it("works as expected", () => {
    expect(getHost("http://localhost", 8080)).toEqual("http://localhost:8080");
    expect(getHost("https://localhost", 8080)).toEqual(
      "https://localhost:8080",
    );
  });
  it("prefers port in url", () => {
    expect(getHost("http://localhost:8888", 8080)).toEqual(
      "http://localhost:8888",
    );
  });
  it("tries best if URL is malformed", () => {
    expect(getHost("localhost", 8080)).toEqual("http://localhost:8080");
  });
});

describe("formatAsync", () => {
  it("formats SQL using worker threads", async () => {
    const sql = "SELECT id, name, email FROM users WHERE active = 1";
    const result = await formatAsync(sql, "postgresql");

    expect(result).toEqual(`SELECT
  id,
  name,
  email
FROM
  users
WHERE
  active = 1`);
  });

  it("handles SQL without dialect", async () => {
    const sql = "SELECT * FROM users";
    const result = await formatAsync(sql);

    // Without dialect, should return original SQL
    expect(result).toEqual(sql);
  });

  it("handles formatting errors gracefully", async () => {
    const invalidSql = "SELECT ((( INVALID";
    let errorCalled = false;

    const result = await formatAsync(invalidSql, "postgresql", (error) => {
      errorCalled = true;
      expect(error.error).toBeDefined();
      expect(error.originalSql).toEqual(invalidSql);
    });

    // Should return original SQL on error
    expect(result).toEqual(invalidSql);
    expect(errorCalled).toBe(true);
  });

  it("processes multiple requests in parallel", async () => {
    const queries = Array.from(
      { length: 5 },
      (_, i) => `SELECT id, name FROM table_${i} WHERE status = 'active'`,
    );

    const results = await Promise.all(
      queries.map((sql) => formatAsync(sql, "postgresql")),
    );

    expect(results).toHaveLength(5);
    results.forEach((result, i) => {
      expect(result).toContain("SELECT");
      expect(result).toContain(`table_${i}`);
    });
  });
});
