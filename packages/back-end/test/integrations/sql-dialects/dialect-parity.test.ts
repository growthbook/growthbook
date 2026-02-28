/**
 * Dialect Parity Tests
 *
 * These tests verify that the extracted dialect modules produce IDENTICAL
 * output to the original SqlIntegration/BigQuery class methods.
 *
 * IMPORTANT: These tests require the full build to be working (yarn build:deps).
 * They compare the output of the extracted dialect modules against the original
 * class methods to ensure the refactoring doesn't change behavior.
 *
 * To run these tests:
 * 1. Run `yarn build:deps` from the root directory
 * 2. Run `yarn workspace back-end test test/integrations/sql-dialects/dialect-parity.test.ts`
 *
 * If you see "@growthbook/growthbook not found" errors, the SDK hasn't been built.
 * Run `yarn` from the root first.
 */

import { bigQueryDialect } from "../../../src/integrations/sql-dialects/bigquery-dialect";
import { baseDialect } from "../../../src/integrations/sql-dialects/base-dialect";

/**
 * These tests verify the extracted dialects match the EXPECTED behavior
 * documented in the original SqlIntegration.ts and BigQuery.ts files.
 *
 * The expected values are copied directly from the original source code
 * to ensure parity.
 */
describe("BigQuery Dialect - Expected Behavior Parity", () => {
  describe("Date/Time Functions", () => {
    describe("toTimestamp - matches SqlIntegration.toTimestamp", () => {
      // Original: return `'${date.toISOString().substr(0, 19).replace("T", " ")}'`;
      it("formats 2023-01-15T12:30:45.123Z", () => {
        const date = new Date("2023-01-15T12:30:45.123Z");
        const expected = "'2023-01-15 12:30:45'"; // From SqlIntegration.ts line 334
        expect(bigQueryDialect.toTimestamp(date)).toBe(expected);
      });

      it("formats 2023-01-01T00:00:00.000Z", () => {
        const date = new Date("2023-01-01T00:00:00.000Z");
        const expected = "'2023-01-01 00:00:00'";
        expect(bigQueryDialect.toTimestamp(date)).toBe(expected);
      });
    });

    describe("toTimestampWithMs - matches SqlIntegration.toTimestampWithMs", () => {
      // Original: return `'${date.toISOString().substring(0, 23).replace("T", " ")}'`;
      it("formats with milliseconds", () => {
        const date = new Date("2023-01-15T12:30:45.123Z");
        const expected = "'2023-01-15 12:30:45.123'"; // From SqlIntegration.ts line 337
        expect(bigQueryDialect.toTimestampWithMs(date)).toBe(expected);
      });
    });

    describe("addTime - matches BigQuery.addTime", () => {
      // Original BigQuery.ts line 156-164:
      // return `DATETIME_${sign === "+" ? "ADD" : "SUB"}(${col}, INTERVAL ${amount} ${unit.toUpperCase()})`;
      it("adds hours", () => {
        expect(bigQueryDialect.addTime("col", "hour", "+", 5)).toBe(
          "DATETIME_ADD(col, INTERVAL 5 HOUR)"
        );
      });

      it("subtracts minutes", () => {
        expect(bigQueryDialect.addTime("col", "minute", "-", 30)).toBe(
          "DATETIME_SUB(col, INTERVAL 30 MINUTE)"
        );
      });
    });

    describe("dateTrunc - matches BigQuery.dateTrunc", () => {
      // Original BigQuery.ts line 166-167: return `date_trunc(${col}, DAY)`;
      it("truncates to day", () => {
        expect(bigQueryDialect.dateTrunc("timestamp")).toBe(
          "date_trunc(timestamp, DAY)"
        );
      });
    });

    describe("dateDiff - matches BigQuery.dateDiff", () => {
      // Original BigQuery.ts line 169-170: return `date_diff(${endCol}, ${startCol}, DAY)`;
      it("calculates difference in days", () => {
        expect(bigQueryDialect.dateDiff("start", "end")).toBe(
          "date_diff(end, start, DAY)"
        );
      });
    });

    describe("formatDate - matches BigQuery.formatDate", () => {
      // Original BigQuery.ts line 172-173: return `format_date("%F", ${col})`;
      it("formats with %F", () => {
        expect(bigQueryDialect.formatDate("date_col")).toBe(
          'format_date("%F", date_col)'
        );
      });
    });

    describe("formatDateTimeString - matches BigQuery.formatDateTimeString", () => {
      // Original BigQuery.ts line 175-176: return `format_datetime("%F %T", ${col})`;
      it("formats with %F %T", () => {
        expect(bigQueryDialect.formatDateTimeString("datetime_col")).toBe(
          'format_datetime("%F %T", datetime_col)'
        );
      });
    });
  });

  describe("Type Casting", () => {
    describe("castToString - matches BigQuery.castToString", () => {
      // Original BigQuery.ts line 178-179: return `cast(${col} as string)`;
      it("casts to string", () => {
        expect(bigQueryDialect.castToString("col")).toBe("cast(col as string)");
      });
    });

    describe("castUserDateCol - matches BigQuery.castUserDateCol", () => {
      // Original BigQuery.ts line 184-185: return `CAST(${column} as DATETIME)`;
      it("casts to DATETIME", () => {
        expect(bigQueryDialect.castUserDateCol("user_date")).toBe(
          "CAST(user_date as DATETIME)"
        );
      });
    });

    describe("castToDate - matches SqlIntegration.castToDate", () => {
      // Original SqlIntegration.ts line 385-386: return `CAST(${col} AS DATE)`;
      it("casts to DATE", () => {
        expect(bigQueryDialect.castToDate("col")).toBe("CAST(col AS DATE)");
      });
    });

    describe("castToTimestamp - matches SqlIntegration.castToTimestamp", () => {
      // Original SqlIntegration.ts line 388-389: return `CAST(${col} AS TIMESTAMP)`;
      it("casts to TIMESTAMP", () => {
        expect(bigQueryDialect.castToTimestamp("col")).toBe(
          "CAST(col AS TIMESTAMP)"
        );
      });
    });
  });

  describe("String Functions", () => {
    describe("escapeStringLiteral - matches BigQuery.escapeStringLiteral", () => {
      // Original BigQuery.ts line 181-182: return value.replace(/(['\\])/g, "\\$1");
      it("escapes single quotes with backslash", () => {
        expect(bigQueryDialect.escapeStringLiteral("it's")).toBe("it\\'s");
      });

      it("escapes backslashes", () => {
        expect(bigQueryDialect.escapeStringLiteral("path\\to")).toBe(
          "path\\\\to"
        );
      });
    });
  });

  describe("Control Flow", () => {
    describe("ifElse - matches SqlIntegration.ifElse", () => {
      // Original SqlIntegration.ts line 379-380:
      // return `(CASE WHEN ${condition} THEN ${ifTrue} ELSE ${ifFalse} END)`;
      it("generates CASE WHEN", () => {
        expect(bigQueryDialect.ifElse("x > 0", "1", "0")).toBe(
          "(CASE WHEN x > 0 THEN 1 ELSE 0 END)"
        );
      });
    });

    describe("evalBoolean - matches SqlIntegration.evalBoolean", () => {
      // Original SqlIntegration.ts line 447-448:
      // return `${col} IS ${value ? "TRUE" : "FALSE"}`;
      it("evaluates true", () => {
        expect(bigQueryDialect.evalBoolean("active", true)).toBe(
          "active IS TRUE"
        );
      });

      it("evaluates false", () => {
        expect(bigQueryDialect.evalBoolean("active", false)).toBe(
          "active IS FALSE"
        );
      });
    });
  });

  describe("Query Structure", () => {
    describe("selectStarLimit - matches SqlIntegration.selectStarLimit", () => {
      // Original SqlIntegration.ts line 406-407:
      // return `SELECT * FROM ${table} LIMIT ${limit}`;
      it("generates SELECT with LIMIT", () => {
        expect(bigQueryDialect.selectStarLimit("users", 10)).toBe(
          "SELECT * FROM users LIMIT 10"
        );
      });
    });
  });

  describe("JSON Functions", () => {
    describe("extractJSONField - matches BigQuery.extractJSONField", () => {
      // Original BigQuery.ts line 206-208:
      // const raw = `JSON_VALUE(${jsonCol}, '$.${path}')`;
      // return isNumeric ? `CAST(${raw} AS FLOAT64)` : raw;
      it("extracts string field", () => {
        expect(
          bigQueryDialect.extractJSONField("json_col", "user.name", false)
        ).toBe("JSON_VALUE(json_col, '$.user.name')");
      });

      it("extracts numeric field with CAST", () => {
        expect(
          bigQueryDialect.extractJSONField("json_col", "user.age", true)
        ).toBe("CAST(JSON_VALUE(json_col, '$.user.age') AS FLOAT64)");
      });
    });
  });

  describe("Data Types", () => {
    describe("getDataType - matches BigQuery.getDataType", () => {
      // Original BigQuery.ts lines 280-299
      it("maps string to STRING", () => {
        expect(bigQueryDialect.getDataType("string")).toBe("STRING");
      });

      it("maps integer to INT64", () => {
        expect(bigQueryDialect.getDataType("integer")).toBe("INT64");
      });

      it("maps float to FLOAT64", () => {
        expect(bigQueryDialect.getDataType("float")).toBe("FLOAT64");
      });

      it("maps boolean to BOOL", () => {
        expect(bigQueryDialect.getDataType("boolean")).toBe("BOOL");
      });

      it("maps date to DATE", () => {
        expect(bigQueryDialect.getDataType("date")).toBe("DATE");
      });

      it("maps timestamp to TIMESTAMP", () => {
        expect(bigQueryDialect.getDataType("timestamp")).toBe("TIMESTAMP");
      });

      it("maps hll to BYTES", () => {
        expect(bigQueryDialect.getDataType("hll")).toBe("BYTES");
      });
    });
  });

  describe("HLL Functions", () => {
    describe("hasCountDistinctHLL - matches BigQuery.hasCountDistinctHLL", () => {
      // Original BigQuery.ts line 187-188: return true;
      it("returns true", () => {
        expect(bigQueryDialect.hasCountDistinctHLL()).toBe(true);
      });
    });

    describe("hllAggregate - matches BigQuery.hllAggregate", () => {
      // Original BigQuery.ts line 190-191: return `HLL_COUNT.INIT(${col})`;
      it("uses HLL_COUNT.INIT", () => {
        expect(bigQueryDialect.hllAggregate("user_id")).toBe(
          "HLL_COUNT.INIT(user_id)"
        );
      });
    });

    describe("hllReaggregate - matches BigQuery.hllReaggregate", () => {
      // Original BigQuery.ts line 193-194: return `HLL_COUNT.MERGE_PARTIAL(${col})`;
      it("uses HLL_COUNT.MERGE_PARTIAL", () => {
        expect(bigQueryDialect.hllReaggregate("hll_col")).toBe(
          "HLL_COUNT.MERGE_PARTIAL(hll_col)"
        );
      });
    });

    describe("hllCardinality - matches BigQuery.hllCardinality", () => {
      // Original BigQuery.ts line 196-197: return `HLL_COUNT.EXTRACT(${col})`;
      it("uses HLL_COUNT.EXTRACT", () => {
        expect(bigQueryDialect.hllCardinality("hll_col")).toBe(
          "HLL_COUNT.EXTRACT(hll_col)"
        );
      });
    });

    describe("castToHllDataType - matches BigQuery behavior", () => {
      // Uses getDataType("hll") which returns BYTES in BigQuery
      it("casts to BYTES", () => {
        expect(bigQueryDialect.castToHllDataType("col")).toBe(
          "CAST(col AS BYTES)"
        );
      });
    });
  });

  describe("Quantile Functions", () => {
    describe("approxQuantile - matches BigQuery.approxQuantile", () => {
      // Original BigQuery.ts line 199-204:
      // const multiplier = 10000;
      // const quantileVal = Number(quantile) ? Math.trunc(multiplier * Number(quantile)) : `${multiplier} * ${quantile}`;
      // return `APPROX_QUANTILES(${value}, ${multiplier} IGNORE NULLS)[OFFSET(CAST(${quantileVal} AS INT64))]`;
      it("handles numeric quantile 0.5", () => {
        expect(bigQueryDialect.approxQuantile("value", 0.5)).toBe(
          "APPROX_QUANTILES(value, 10000 IGNORE NULLS)[OFFSET(CAST(5000 AS INT64))]"
        );
      });

      it("handles numeric quantile 0.25", () => {
        expect(bigQueryDialect.approxQuantile("value", 0.25)).toBe(
          "APPROX_QUANTILES(value, 10000 IGNORE NULLS)[OFFSET(CAST(2500 AS INT64))]"
        );
      });

      it("handles string quantile expression", () => {
        expect(bigQueryDialect.approxQuantile("value", "q")).toBe(
          "APPROX_QUANTILES(value, 10000 IGNORE NULLS)[OFFSET(CAST(10000 * q AS INT64))]"
        );
      });
    });
  });
});

describe("Base Dialect - Expected Behavior Parity with SqlIntegration", () => {
  describe("toTimestamp", () => {
    // Original SqlIntegration.ts line 333-334:
    // return `'${date.toISOString().substr(0, 19).replace("T", " ")}'`;
    it("matches SqlIntegration default", () => {
      const date = new Date("2023-01-15T12:30:45.123Z");
      expect(baseDialect.toTimestamp(date)).toBe("'2023-01-15 12:30:45'");
    });
  });

  describe("addTime", () => {
    // Original SqlIntegration.ts line 362-368:
    // return `${col} ${sign} INTERVAL '${amount} ${unit}s'`;
    it("matches SqlIntegration default", () => {
      expect(baseDialect.addTime("col", "hour", "+", 5)).toBe(
        "col + INTERVAL '5 hours'"
      );
    });
  });

  describe("dateTrunc", () => {
    // Original SqlIntegration.ts line 370-371:
    // return `date_trunc('day', ${col})`;
    it("matches SqlIntegration default", () => {
      expect(baseDialect.dateTrunc("timestamp")).toBe(
        "date_trunc('day', timestamp)"
      );
    });
  });

  describe("dateDiff", () => {
    // Original SqlIntegration.ts line 373-374:
    // return `datediff(day, ${startCol}, ${endCol})`;
    it("matches SqlIntegration default", () => {
      expect(baseDialect.dateDiff("start", "end")).toBe(
        "datediff(day, start, end)"
      );
    });
  });

  describe("castToString", () => {
    // Original SqlIntegration.ts line 382-383:
    // return `cast(${col} as varchar)`;
    it("matches SqlIntegration default", () => {
      expect(baseDialect.castToString("col")).toBe("cast(col as varchar)");
    });
  });

  describe("escapeStringLiteral", () => {
    // Original SqlIntegration.ts line 397-398:
    // return value.replace(/'/g, `''`);
    it("matches SqlIntegration default (double single quotes)", () => {
      expect(baseDialect.escapeStringLiteral("it's")).toBe("it''s");
    });
  });

  describe("getDataType", () => {
    // Base dialect uses standard SQL types
    it("maps string to VARCHAR", () => {
      expect(baseDialect.getDataType("string")).toBe("VARCHAR");
    });

    it("maps float to FLOAT", () => {
      expect(baseDialect.getDataType("float")).toBe("FLOAT");
    });
  });
});

/**
 * Runtime parity tests - compare actual BigQuery class output vs extracted dialects.
 * These tests directly instantiate BigQuery and compare method outputs.
 */
describe("Runtime Parity Tests", () => {
  // Lazy import to avoid issues if build isn't ready
  let BigQuery: typeof import("../../../src/integrations/BigQuery").default;
  let bqInstance: InstanceType<typeof BigQuery>;

  beforeAll(async () => {
    const module = await import("../../../src/integrations/BigQuery");
    BigQuery = module.default;
    // @ts-expect-error - context not needed for dialect method testing
    bqInstance = new BigQuery("", {});
  });

  describe("Date/Time Functions", () => {
    const testDates = [
      new Date("2023-01-15T12:30:45.123Z"),
      new Date("2023-01-01T00:00:00.000Z"),
      new Date("2023-12-31T23:59:59.999Z"),
    ];

    describe("toTimestamp", () => {
      testDates.forEach((date) => {
        it(`matches BigQuery class for ${date.toISOString()}`, () => {
          expect(bigQueryDialect.toTimestamp(date)).toBe(
            bqInstance.toTimestamp(date)
          );
        });
      });
    });

    describe("toTimestampWithMs", () => {
      testDates.forEach((date) => {
        it(`matches BigQuery class for ${date.toISOString()}`, () => {
          expect(bigQueryDialect.toTimestampWithMs(date)).toBe(
            bqInstance.toTimestampWithMs(date)
          );
        });
      });
    });

    describe("addTime", () => {
      const cases: Array<{
        col: string;
        unit: "hour" | "minute";
        sign: "+" | "-";
        amount: number;
      }> = [
        { col: "ts", unit: "hour", sign: "+", amount: 5 },
        { col: "ts", unit: "hour", sign: "-", amount: 10 },
        { col: "ts", unit: "minute", sign: "+", amount: 30 },
        { col: "ts", unit: "minute", sign: "-", amount: 90 },
      ];

      cases.forEach(({ col, unit, sign, amount }) => {
        it(`matches BigQuery class for addTime('${col}', '${unit}', '${sign}', ${amount})`, () => {
          expect(bigQueryDialect.addTime(col, unit, sign, amount)).toBe(
            bqInstance.addTime(col, unit, sign, amount)
          );
        });
      });
    });

    describe("addHours", () => {
      const cases = [0, 1, 24, -12, 1.5, 0.25];
      cases.forEach((hours) => {
        it(`matches BigQuery class for addHours('col', ${hours})`, () => {
          expect(bigQueryDialect.addHours("col", hours)).toBe(
            bqInstance.addHours("col", hours)
          );
        });
      });
    });

    describe("dateTrunc", () => {
      it("matches BigQuery class", () => {
        expect(bigQueryDialect.dateTrunc("timestamp")).toBe(
          bqInstance.dateTrunc("timestamp")
        );
      });
    });

    describe("dateDiff", () => {
      it("matches BigQuery class", () => {
        expect(bigQueryDialect.dateDiff("start", "end")).toBe(
          bqInstance.dateDiff("start", "end")
        );
      });
    });

    describe("formatDate", () => {
      it("matches BigQuery class", () => {
        expect(bigQueryDialect.formatDate("date_col")).toBe(
          bqInstance.formatDate("date_col")
        );
      });
    });

    describe("formatDateTimeString", () => {
      it("matches BigQuery class", () => {
        expect(bigQueryDialect.formatDateTimeString("datetime_col")).toBe(
          bqInstance.formatDateTimeString("datetime_col")
        );
      });
    });
  });

  describe("Type Casting", () => {
    describe("castToString", () => {
      it("matches BigQuery class", () => {
        expect(bigQueryDialect.castToString("col")).toBe(
          bqInstance.castToString("col")
        );
      });
    });

    describe("castUserDateCol", () => {
      it("matches BigQuery class", () => {
        expect(bigQueryDialect.castUserDateCol("user_date")).toBe(
          bqInstance.castUserDateCol("user_date")
        );
      });
    });

    describe("castToDate", () => {
      it("matches BigQuery class", () => {
        expect(bigQueryDialect.castToDate("col")).toBe(
          bqInstance.castToDate("col")
        );
      });
    });

    describe("castToTimestamp", () => {
      it("matches BigQuery class", () => {
        expect(bigQueryDialect.castToTimestamp("col")).toBe(
          bqInstance.castToTimestamp("col")
        );
      });
    });
  });

  describe("String Functions", () => {
    describe("escapeStringLiteral", () => {
      const cases = ["simple", "it's", "path\\to", "both 'and' \\"];
      cases.forEach((str) => {
        it(`matches BigQuery class for '${str}'`, () => {
          expect(bigQueryDialect.escapeStringLiteral(str)).toBe(
            bqInstance.escapeStringLiteral(str)
          );
        });
      });
    });
  });

  describe("JSON Functions", () => {
    describe("extractJSONField", () => {
      it("matches BigQuery class for string field", () => {
        expect(
          bigQueryDialect.extractJSONField("json_col", "user.name", false)
        ).toBe(bqInstance.extractJSONField("json_col", "user.name", false));
      });

      it("matches BigQuery class for numeric field", () => {
        expect(
          bigQueryDialect.extractJSONField("json_col", "user.age", true)
        ).toBe(bqInstance.extractJSONField("json_col", "user.age", true));
      });
    });
  });

  describe("Data Types", () => {
    const types: Array<
      "string" | "integer" | "float" | "boolean" | "date" | "timestamp" | "hll"
    > = ["string", "integer", "float", "boolean", "date", "timestamp", "hll"];

    types.forEach((type) => {
      it(`matches BigQuery class for getDataType('${type}')`, () => {
        expect(bigQueryDialect.getDataType(type)).toBe(
          bqInstance.getDataType(type)
        );
      });
    });
  });

  describe("HLL Functions", () => {
    it("hasCountDistinctHLL matches", () => {
      expect(bigQueryDialect.hasCountDistinctHLL()).toBe(
        bqInstance.hasCountDistinctHLL()
      );
    });

    it("hllAggregate matches", () => {
      expect(bigQueryDialect.hllAggregate("user_id")).toBe(
        bqInstance.hllAggregate("user_id")
      );
    });

    it("hllReaggregate matches", () => {
      expect(bigQueryDialect.hllReaggregate("hll_col")).toBe(
        bqInstance.hllReaggregate("hll_col")
      );
    });

    it("hllCardinality matches", () => {
      expect(bigQueryDialect.hllCardinality("hll_col")).toBe(
        bqInstance.hllCardinality("hll_col")
      );
    });
  });

  describe("Quantile Functions", () => {
    const quantiles = [0.25, 0.5, 0.75, 0.99, "q"];
    quantiles.forEach((q) => {
      it(`matches BigQuery class for approxQuantile('value', ${q})`, () => {
        expect(bigQueryDialect.approxQuantile("value", q)).toBe(
          bqInstance.approxQuantile("value", q)
        );
      });
    });
  });
});
