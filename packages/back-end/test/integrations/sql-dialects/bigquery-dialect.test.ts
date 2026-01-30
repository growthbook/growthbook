import {
  bigQueryDialect,
  baseDialect,
  hasHllSupport,
  hasQuantileSupport,
} from "../../../src/integrations/sql-dialects";

describe("BigQuery Dialect", () => {
  describe("formatDialect", () => {
    it("returns bigquery", () => {
      expect(bigQueryDialect.formatDialect).toBe("bigquery");
    });
  });

  describe("toTimestamp", () => {
    it("formats date without milliseconds", () => {
      const date = new Date("2023-01-15T12:30:45.123Z");
      expect(bigQueryDialect.toTimestamp(date)).toBe("'2023-01-15 12:30:45'");
    });

    it("handles midnight correctly", () => {
      const date = new Date("2023-01-01T00:00:00Z");
      expect(bigQueryDialect.toTimestamp(date)).toBe("'2023-01-01 00:00:00'");
    });
  });

  describe("toTimestampWithMs", () => {
    it("formats date with milliseconds", () => {
      const date = new Date("2023-01-15T12:30:45.123Z");
      expect(bigQueryDialect.toTimestampWithMs(date)).toBe(
        "'2023-01-15 12:30:45.123'"
      );
    });
  });

  describe("addHours", () => {
    it("returns column unchanged when hours is 0", () => {
      expect(bigQueryDialect.addHours("timestamp", 0)).toBe("timestamp");
    });

    it("adds positive hours using DATETIME_ADD", () => {
      expect(bigQueryDialect.addHours("timestamp", 24)).toBe(
        "DATETIME_ADD(timestamp, INTERVAL 24 HOUR)"
      );
    });

    it("subtracts negative hours using DATETIME_SUB", () => {
      expect(bigQueryDialect.addHours("timestamp", -12)).toBe(
        "DATETIME_SUB(timestamp, INTERVAL 12 HOUR)"
      );
    });

    it("uses minutes for fractional hours", () => {
      expect(bigQueryDialect.addHours("timestamp", 1.5)).toBe(
        "DATETIME_ADD(timestamp, INTERVAL 90 MINUTE)"
      );
    });
  });

  describe("addTime", () => {
    it("adds hours with DATETIME_ADD", () => {
      expect(bigQueryDialect.addTime("col", "hour", "+", 5)).toBe(
        "DATETIME_ADD(col, INTERVAL 5 HOUR)"
      );
    });

    it("subtracts minutes with DATETIME_SUB", () => {
      expect(bigQueryDialect.addTime("col", "minute", "-", 30)).toBe(
        "DATETIME_SUB(col, INTERVAL 30 MINUTE)"
      );
    });
  });

  describe("dateTrunc", () => {
    it("truncates to day", () => {
      expect(bigQueryDialect.dateTrunc("timestamp")).toBe(
        "date_trunc(timestamp, DAY)"
      );
    });
  });

  describe("dateDiff", () => {
    it("calculates difference in days", () => {
      expect(bigQueryDialect.dateDiff("start_date", "end_date")).toBe(
        "date_diff(end_date, start_date, DAY)"
      );
    });
  });

  describe("formatDate", () => {
    it("formats date with %F", () => {
      expect(bigQueryDialect.formatDate("date_col")).toBe(
        'format_date("%F", date_col)'
      );
    });
  });

  describe("formatDateTimeString", () => {
    it("formats datetime with %F %T", () => {
      expect(bigQueryDialect.formatDateTimeString("datetime_col")).toBe(
        'format_datetime("%F %T", datetime_col)'
      );
    });
  });

  describe("castToString", () => {
    it("casts to string type", () => {
      expect(bigQueryDialect.castToString("numeric_col")).toBe(
        "cast(numeric_col as string)"
      );
    });
  });

  describe("castUserDateCol", () => {
    it("casts to DATETIME", () => {
      expect(bigQueryDialect.castUserDateCol("user_date")).toBe(
        "CAST(user_date as DATETIME)"
      );
    });
  });

  describe("escapeStringLiteral", () => {
    it("escapes single quotes with backslash", () => {
      expect(bigQueryDialect.escapeStringLiteral("it's")).toBe("it\\'s");
    });

    it("escapes backslashes", () => {
      expect(bigQueryDialect.escapeStringLiteral("path\\to\\file")).toBe(
        "path\\\\to\\\\file"
      );
    });

    it("handles strings without special characters", () => {
      expect(bigQueryDialect.escapeStringLiteral("hello world")).toBe(
        "hello world"
      );
    });
  });

  describe("ifElse", () => {
    it("generates CASE WHEN expression", () => {
      expect(bigQueryDialect.ifElse("x > 0", "1", "0")).toBe(
        "(CASE WHEN x > 0 THEN 1 ELSE 0 END)"
      );
    });
  });

  describe("evalBoolean", () => {
    it("evaluates true", () => {
      expect(bigQueryDialect.evalBoolean("active", true)).toBe("active IS TRUE");
    });

    it("evaluates false", () => {
      expect(bigQueryDialect.evalBoolean("active", false)).toBe(
        "active IS FALSE"
      );
    });
  });

  describe("selectStarLimit", () => {
    it("generates SELECT with LIMIT", () => {
      expect(bigQueryDialect.selectStarLimit("users", 10)).toBe(
        "SELECT * FROM users LIMIT 10"
      );
    });
  });

  describe("extractJSONField", () => {
    it("extracts string field with JSON_VALUE", () => {
      expect(bigQueryDialect.extractJSONField("json_col", "user.name", false)).toBe(
        "JSON_VALUE(json_col, '$.user.name')"
      );
    });

    it("extracts numeric field with CAST to FLOAT64", () => {
      expect(bigQueryDialect.extractJSONField("json_col", "user.age", true)).toBe(
        "CAST(JSON_VALUE(json_col, '$.user.age') AS FLOAT64)"
      );
    });
  });

  describe("getDataType", () => {
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

  describe("HLL functions", () => {
    it("supports HLL", () => {
      expect(bigQueryDialect.hasCountDistinctHLL()).toBe(true);
    });

    it("aggregates with HLL_COUNT.INIT", () => {
      expect(bigQueryDialect.hllAggregate("user_id")).toBe(
        "HLL_COUNT.INIT(user_id)"
      );
    });

    it("reaggregates with HLL_COUNT.MERGE_PARTIAL", () => {
      expect(bigQueryDialect.hllReaggregate("hll_col")).toBe(
        "HLL_COUNT.MERGE_PARTIAL(hll_col)"
      );
    });

    it("extracts cardinality with HLL_COUNT.EXTRACT", () => {
      expect(bigQueryDialect.hllCardinality("hll_col")).toBe(
        "HLL_COUNT.EXTRACT(hll_col)"
      );
    });

    it("casts to HLL data type (BYTES)", () => {
      expect(bigQueryDialect.castToHllDataType("col")).toBe("CAST(col AS BYTES)");
    });
  });

  describe("Quantile functions", () => {
    it("has efficient percentile", () => {
      expect(bigQueryDialect.hasEfficientPercentile()).toBe(true);
    });

    it("has quantile testing", () => {
      expect(bigQueryDialect.hasQuantileTesting()).toBe(true);
    });

    it("generates APPROX_QUANTILES for numeric quantile", () => {
      expect(bigQueryDialect.approxQuantile("value", 0.5)).toBe(
        "APPROX_QUANTILES(value, 10000 IGNORE NULLS)[OFFSET(CAST(5000 AS INT64))]"
      );
    });

    it("generates APPROX_QUANTILES for string quantile expression", () => {
      expect(bigQueryDialect.approxQuantile("value", "q")).toBe(
        "APPROX_QUANTILES(value, 10000 IGNORE NULLS)[OFFSET(CAST(10000 * q AS INT64))]"
      );
    });

    it("handles edge quantile values", () => {
      // Note: 0 is falsy in JS, so it uses the string path (still valid SQL)
      expect(bigQueryDialect.approxQuantile("value", 0)).toBe(
        "APPROX_QUANTILES(value, 10000 IGNORE NULLS)[OFFSET(CAST(10000 * 0 AS INT64))]"
      );
      expect(bigQueryDialect.approxQuantile("value", 1)).toBe(
        "APPROX_QUANTILES(value, 10000 IGNORE NULLS)[OFFSET(CAST(10000 AS INT64))]"
      );
    });
  });

  describe("Type guards", () => {
    it("hasHllSupport returns true for BigQuery", () => {
      expect(hasHllSupport(bigQueryDialect)).toBe(true);
    });

    it("hasHllSupport returns false for base dialect", () => {
      expect(hasHllSupport(baseDialect)).toBe(false);
    });

    it("hasQuantileSupport returns true for BigQuery", () => {
      expect(hasQuantileSupport(bigQueryDialect)).toBe(true);
    });

    it("hasQuantileSupport returns false for base dialect", () => {
      expect(hasQuantileSupport(baseDialect)).toBe(false);
    });
  });
});

describe("Base Dialect", () => {
  describe("formatDialect", () => {
    it("returns empty string", () => {
      expect(baseDialect.formatDialect).toBe("");
    });
  });

  describe("toTimestamp", () => {
    it("formats date in ISO-like format", () => {
      const date = new Date("2023-01-15T12:30:45.123Z");
      expect(baseDialect.toTimestamp(date)).toBe("'2023-01-15 12:30:45'");
    });
  });

  describe("addTime", () => {
    it("uses INTERVAL syntax", () => {
      expect(baseDialect.addTime("col", "hour", "+", 5)).toBe(
        "col + INTERVAL '5 hours'"
      );
    });

    it("uses negative INTERVAL for subtraction", () => {
      expect(baseDialect.addTime("col", "minute", "-", 30)).toBe(
        "col - INTERVAL '30 minutes'"
      );
    });
  });

  describe("dateTrunc", () => {
    it("uses date_trunc function", () => {
      expect(baseDialect.dateTrunc("timestamp")).toBe(
        "date_trunc('day', timestamp)"
      );
    });
  });

  describe("dateDiff", () => {
    it("uses datediff function", () => {
      expect(baseDialect.dateDiff("start", "end")).toBe(
        "datediff(day, start, end)"
      );
    });
  });

  describe("castToString", () => {
    it("casts to varchar", () => {
      expect(baseDialect.castToString("col")).toBe("cast(col as varchar)");
    });
  });

  describe("escapeStringLiteral", () => {
    it("escapes single quotes by doubling", () => {
      expect(baseDialect.escapeStringLiteral("it's")).toBe("it''s");
    });
  });

  describe("getDataType", () => {
    it("maps string to VARCHAR", () => {
      expect(baseDialect.getDataType("string")).toBe("VARCHAR");
    });

    it("maps float to FLOAT", () => {
      expect(baseDialect.getDataType("float")).toBe("FLOAT");
    });
  });
});
