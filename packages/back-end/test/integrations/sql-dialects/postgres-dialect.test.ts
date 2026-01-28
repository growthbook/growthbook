import {
  postgresDialect,
  hasHllSupport,
  hasQuantileSupport,
} from "../../../src/integrations/sql-dialects";

describe("PostgreSQL Dialect", () => {
  describe("formatDialect", () => {
    it("returns postgresql", () => {
      expect(postgresDialect.formatDialect).toBe("postgresql");
    });
  });

  describe("toTimestamp", () => {
    it("formats date without milliseconds (inherited from base)", () => {
      const date = new Date("2023-01-15T12:30:45.123Z");
      expect(postgresDialect.toTimestamp(date)).toBe("'2023-01-15 12:30:45'");
    });
  });

  describe("addHours", () => {
    it("returns column unchanged when hours is 0", () => {
      expect(postgresDialect.addHours("timestamp", 0)).toBe("timestamp");
    });

    it("adds positive hours using INTERVAL syntax", () => {
      expect(postgresDialect.addHours("timestamp", 24)).toBe(
        "timestamp + INTERVAL '24 hours'"
      );
    });

    it("subtracts negative hours", () => {
      expect(postgresDialect.addHours("timestamp", -12)).toBe(
        "timestamp - INTERVAL '12 hours'"
      );
    });
  });

  describe("addTime", () => {
    it("adds hours with INTERVAL syntax", () => {
      expect(postgresDialect.addTime("col", "hour", "+", 5)).toBe(
        "col + INTERVAL '5 hours'"
      );
    });

    it("subtracts minutes with INTERVAL syntax", () => {
      expect(postgresDialect.addTime("col", "minute", "-", 30)).toBe(
        "col - INTERVAL '30 minutes'"
      );
    });
  });

  describe("dateTrunc", () => {
    it("truncates to day using date_trunc", () => {
      expect(postgresDialect.dateTrunc("timestamp")).toBe(
        "date_trunc('day', timestamp)"
      );
    });
  });

  describe("dateDiff", () => {
    it("calculates difference using subtraction with ::DATE cast", () => {
      expect(postgresDialect.dateDiff("start_date", "end_date")).toBe(
        "end_date::DATE - start_date::DATE"
      );
    });
  });

  describe("formatDate", () => {
    it("formats date with to_char YYYY-MM-DD", () => {
      expect(postgresDialect.formatDate("date_col")).toBe(
        "to_char(date_col, 'YYYY-MM-DD')"
      );
    });
  });

  describe("formatDateTimeString", () => {
    it("formats datetime with to_char including milliseconds", () => {
      expect(postgresDialect.formatDateTimeString("datetime_col")).toBe(
        "to_char(datetime_col, 'YYYY-MM-DD HH24:MI:SS.MS')"
      );
    });
  });

  describe("castToString", () => {
    it("casts using varchar (inherited from base)", () => {
      expect(postgresDialect.castToString("numeric_col")).toBe(
        "cast(numeric_col as varchar)"
      );
    });
  });

  describe("ensureFloat", () => {
    it("casts using :: syntax", () => {
      expect(postgresDialect.ensureFloat("int_col")).toBe("int_col::float");
    });
  });

  describe("escapeStringLiteral", () => {
    it("escapes single quotes by doubling", () => {
      expect(postgresDialect.escapeStringLiteral("it's")).toBe("it''s");
    });
  });

  describe("ifElse", () => {
    it("generates CASE WHEN expression", () => {
      expect(postgresDialect.ifElse("x > 0", "1", "0")).toBe(
        "(CASE WHEN x > 0 THEN 1 ELSE 0 END)"
      );
    });
  });

  describe("evalBoolean", () => {
    it("evaluates true", () => {
      expect(postgresDialect.evalBoolean("active", true)).toBe(
        "active IS TRUE"
      );
    });

    it("evaluates false", () => {
      expect(postgresDialect.evalBoolean("active", false)).toBe(
        "active IS FALSE"
      );
    });
  });

  describe("selectStarLimit", () => {
    it("generates SELECT with LIMIT", () => {
      expect(postgresDialect.selectStarLimit("users", 10)).toBe(
        "SELECT * FROM users LIMIT 10"
      );
    });
  });

  describe("extractJSONField", () => {
    it("extracts string field with JSON_EXTRACT_PATH_TEXT", () => {
      expect(
        postgresDialect.extractJSONField("json_col", "user.name", false)
      ).toBe("JSON_EXTRACT_PATH_TEXT(json_col::json, 'user', 'name')");
    });

    it("extracts numeric field with float cast", () => {
      expect(
        postgresDialect.extractJSONField("json_col", "user.age", true)
      ).toBe("JSON_EXTRACT_PATH_TEXT(json_col::json, 'user', 'age')::float");
    });

    it("handles single-level paths", () => {
      expect(postgresDialect.extractJSONField("json_col", "name", false)).toBe(
        "JSON_EXTRACT_PATH_TEXT(json_col::json, 'name')"
      );
    });
  });

  describe("getDataType", () => {
    it("maps string to VARCHAR (inherited from base)", () => {
      expect(postgresDialect.getDataType("string")).toBe("VARCHAR");
    });

    it("maps float to FLOAT (inherited from base)", () => {
      expect(postgresDialect.getDataType("float")).toBe("FLOAT");
    });
  });

  describe("HLL functions", () => {
    it("does not support HLL", () => {
      expect(postgresDialect.hasCountDistinctHLL()).toBe(false);
    });

    it("throws error for hllAggregate", () => {
      expect(() => postgresDialect.hllAggregate("user_id")).toThrow(
        "PostgreSQL does not support HyperLogLog natively"
      );
    });

    it("throws error for hllReaggregate", () => {
      expect(() => postgresDialect.hllReaggregate("hll_col")).toThrow(
        "PostgreSQL does not support HyperLogLog natively"
      );
    });

    it("throws error for hllCardinality", () => {
      expect(() => postgresDialect.hllCardinality("hll_col")).toThrow(
        "PostgreSQL does not support HyperLogLog natively"
      );
    });
  });

  describe("Quantile functions", () => {
    it("has efficient percentile", () => {
      expect(postgresDialect.hasEfficientPercentile()).toBe(true);
    });

    it("has quantile testing", () => {
      expect(postgresDialect.hasQuantileTesting()).toBe(true);
    });

    it("generates PERCENTILE_CONT for numeric quantile", () => {
      expect(postgresDialect.approxQuantile("value", 0.5)).toBe(
        "PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY value)"
      );
    });

    it("generates PERCENTILE_CONT for string quantile expression", () => {
      expect(postgresDialect.approxQuantile("value", "q")).toBe(
        "PERCENTILE_CONT(q) WITHIN GROUP (ORDER BY value)"
      );
    });
  });

  describe("Type guards", () => {
    it("hasHllSupport returns false for PostgreSQL", () => {
      expect(hasHllSupport(postgresDialect)).toBe(false);
    });

    it("hasQuantileSupport returns true for PostgreSQL", () => {
      expect(hasQuantileSupport(postgresDialect)).toBe(true);
    });
  });
});
