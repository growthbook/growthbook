import {
  snowflakeDialect,
  hasHllSupport,
  hasQuantileSupport,
} from "../../../src/integrations/sql-dialects";

describe("Snowflake Dialect", () => {
  describe("formatDialect", () => {
    it("returns snowflake", () => {
      expect(snowflakeDialect.formatDialect).toBe("snowflake");
    });
  });

  describe("toTimestamp", () => {
    it("formats date without milliseconds (inherited from base)", () => {
      const date = new Date("2023-01-15T12:30:45.123Z");
      expect(snowflakeDialect.toTimestamp(date)).toBe("'2023-01-15 12:30:45'");
    });

    it("handles midnight correctly", () => {
      const date = new Date("2023-01-01T00:00:00Z");
      expect(snowflakeDialect.toTimestamp(date)).toBe("'2023-01-01 00:00:00'");
    });
  });

  describe("toTimestampWithMs", () => {
    it("formats date with milliseconds (inherited from base)", () => {
      const date = new Date("2023-01-15T12:30:45.123Z");
      expect(snowflakeDialect.toTimestampWithMs(date)).toBe(
        "'2023-01-15 12:30:45.123'"
      );
    });
  });

  describe("addHours", () => {
    it("returns column unchanged when hours is 0", () => {
      expect(snowflakeDialect.addHours("timestamp", 0)).toBe("timestamp");
    });

    it("adds positive hours using INTERVAL syntax", () => {
      expect(snowflakeDialect.addHours("timestamp", 24)).toBe(
        "timestamp + INTERVAL '24 hours'"
      );
    });

    it("subtracts negative hours", () => {
      expect(snowflakeDialect.addHours("timestamp", -12)).toBe(
        "timestamp - INTERVAL '12 hours'"
      );
    });

    it("uses minutes for fractional hours", () => {
      expect(snowflakeDialect.addHours("timestamp", 1.5)).toBe(
        "timestamp + INTERVAL '90 minutes'"
      );
    });
  });

  describe("addTime", () => {
    it("adds hours with INTERVAL syntax", () => {
      expect(snowflakeDialect.addTime("col", "hour", "+", 5)).toBe(
        "col + INTERVAL '5 hours'"
      );
    });

    it("subtracts minutes with INTERVAL syntax", () => {
      expect(snowflakeDialect.addTime("col", "minute", "-", 30)).toBe(
        "col - INTERVAL '30 minutes'"
      );
    });
  });

  describe("dateTrunc", () => {
    it("truncates to day using date_trunc", () => {
      expect(snowflakeDialect.dateTrunc("timestamp")).toBe(
        "date_trunc('day', timestamp)"
      );
    });
  });

  describe("dateDiff", () => {
    it("calculates difference in days", () => {
      expect(snowflakeDialect.dateDiff("start_date", "end_date")).toBe(
        "datediff(day, start_date, end_date)"
      );
    });
  });

  describe("formatDate", () => {
    it("formats date with TO_VARCHAR YYYY-MM-DD", () => {
      expect(snowflakeDialect.formatDate("date_col")).toBe(
        "TO_VARCHAR(date_col, 'YYYY-MM-DD')"
      );
    });
  });

  describe("formatDateTimeString", () => {
    it("formats datetime with TO_VARCHAR including milliseconds", () => {
      expect(snowflakeDialect.formatDateTimeString("datetime_col")).toBe(
        "TO_VARCHAR(datetime_col, 'YYYY-MM-DD HH24:MI:SS.MS')"
      );
    });
  });

  describe("castToString", () => {
    it("casts using TO_VARCHAR", () => {
      expect(snowflakeDialect.castToString("numeric_col")).toBe(
        "TO_VARCHAR(numeric_col)"
      );
    });
  });

  describe("ensureFloat", () => {
    it("casts to DOUBLE", () => {
      expect(snowflakeDialect.ensureFloat("int_col")).toBe(
        "CAST(int_col AS DOUBLE)"
      );
    });
  });

  describe("castUserDateCol", () => {
    it("returns column unchanged (inherited from base)", () => {
      expect(snowflakeDialect.castUserDateCol("user_date")).toBe("user_date");
    });
  });

  describe("escapeStringLiteral", () => {
    it("escapes single quotes by doubling (inherited from base)", () => {
      expect(snowflakeDialect.escapeStringLiteral("it's")).toBe("it''s");
    });

    it("handles strings without special characters", () => {
      expect(snowflakeDialect.escapeStringLiteral("hello world")).toBe(
        "hello world"
      );
    });
  });

  describe("ifElse", () => {
    it("generates CASE WHEN expression", () => {
      expect(snowflakeDialect.ifElse("x > 0", "1", "0")).toBe(
        "(CASE WHEN x > 0 THEN 1 ELSE 0 END)"
      );
    });
  });

  describe("evalBoolean", () => {
    it("evaluates true", () => {
      expect(snowflakeDialect.evalBoolean("active", true)).toBe(
        "active IS TRUE"
      );
    });

    it("evaluates false", () => {
      expect(snowflakeDialect.evalBoolean("active", false)).toBe(
        "active IS FALSE"
      );
    });
  });

  describe("selectStarLimit", () => {
    it("generates SELECT with LIMIT", () => {
      expect(snowflakeDialect.selectStarLimit("users", 10)).toBe(
        "SELECT * FROM users LIMIT 10"
      );
    });
  });

  describe("extractJSONField", () => {
    it("extracts string field with PARSE_JSON", () => {
      expect(
        snowflakeDialect.extractJSONField("json_col", "user.name", false)
      ).toBe("PARSE_JSON(json_col):user.name::string");
    });

    it("extracts numeric field with float cast", () => {
      expect(
        snowflakeDialect.extractJSONField("json_col", "user.age", true)
      ).toBe("PARSE_JSON(json_col):user.age::float");
    });
  });

  describe("getDataType", () => {
    it("maps string to VARCHAR", () => {
      expect(snowflakeDialect.getDataType("string")).toBe("VARCHAR");
    });

    it("maps integer to INTEGER", () => {
      expect(snowflakeDialect.getDataType("integer")).toBe("INTEGER");
    });

    it("maps float to DOUBLE", () => {
      expect(snowflakeDialect.getDataType("float")).toBe("DOUBLE");
    });

    it("maps boolean to BOOLEAN", () => {
      expect(snowflakeDialect.getDataType("boolean")).toBe("BOOLEAN");
    });

    it("maps date to DATE", () => {
      expect(snowflakeDialect.getDataType("date")).toBe("DATE");
    });

    it("maps timestamp to TIMESTAMP", () => {
      expect(snowflakeDialect.getDataType("timestamp")).toBe("TIMESTAMP");
    });

    it("maps hll to BINARY", () => {
      expect(snowflakeDialect.getDataType("hll")).toBe("BINARY");
    });
  });

  describe("HLL functions", () => {
    it("supports HLL", () => {
      expect(snowflakeDialect.hasCountDistinctHLL()).toBe(true);
    });

    it("aggregates with HLL_ACCUMULATE", () => {
      expect(snowflakeDialect.hllAggregate("user_id")).toBe(
        "HLL_ACCUMULATE(user_id)"
      );
    });

    it("reaggregates with HLL_COMBINE", () => {
      expect(snowflakeDialect.hllReaggregate("hll_col")).toBe(
        "HLL_COMBINE(hll_col)"
      );
    });

    it("extracts cardinality with HLL_ESTIMATE", () => {
      expect(snowflakeDialect.hllCardinality("hll_col")).toBe(
        "HLL_ESTIMATE(hll_col)"
      );
    });

    it("casts to HLL data type (BINARY)", () => {
      expect(snowflakeDialect.castToHllDataType("col")).toBe(
        "CAST(col AS BINARY)"
      );
    });
  });

  describe("Quantile functions", () => {
    it("has efficient percentile", () => {
      expect(snowflakeDialect.hasEfficientPercentile()).toBe(true);
    });

    it("has quantile testing", () => {
      expect(snowflakeDialect.hasQuantileTesting()).toBe(true);
    });

    it("generates APPROX_PERCENTILE for numeric quantile", () => {
      expect(snowflakeDialect.approxQuantile("value", 0.5)).toBe(
        "APPROX_PERCENTILE(value, 0.5)"
      );
    });

    it("generates APPROX_PERCENTILE for string quantile expression", () => {
      expect(snowflakeDialect.approxQuantile("value", "q")).toBe(
        "APPROX_PERCENTILE(value, q)"
      );
    });
  });

  describe("Type guards", () => {
    it("hasHllSupport returns true for Snowflake", () => {
      expect(hasHllSupport(snowflakeDialect)).toBe(true);
    });

    it("hasQuantileSupport returns true for Snowflake", () => {
      expect(hasQuantileSupport(snowflakeDialect)).toBe(true);
    });
  });
});
