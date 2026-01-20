import {
  mysqlDialect,
  hasHllSupport,
  hasQuantileSupport,
} from "../../../src/integrations/sql-dialects";

describe("MySQL Dialect", () => {
  describe("formatDialect", () => {
    it("returns mysql", () => {
      expect(mysqlDialect.formatDialect).toBe("mysql");
    });
  });

  describe("toTimestamp", () => {
    it("formats date without milliseconds (inherited from base)", () => {
      const date = new Date("2023-01-15T12:30:45.123Z");
      expect(mysqlDialect.toTimestamp(date)).toBe("'2023-01-15 12:30:45'");
    });
  });

  describe("addHours", () => {
    it("returns column unchanged when hours is 0", () => {
      expect(mysqlDialect.addHours("timestamp", 0)).toBe("timestamp");
    });

    it("adds positive hours using DATE_ADD", () => {
      expect(mysqlDialect.addHours("timestamp", 24)).toBe(
        "DATE_ADD(timestamp, INTERVAL 24 HOUR)"
      );
    });

    it("subtracts negative hours using DATE_SUB", () => {
      expect(mysqlDialect.addHours("timestamp", -12)).toBe(
        "DATE_SUB(timestamp, INTERVAL 12 HOUR)"
      );
    });

    it("uses minutes for fractional hours", () => {
      expect(mysqlDialect.addHours("timestamp", 1.5)).toBe(
        "DATE_ADD(timestamp, INTERVAL 90 MINUTE)"
      );
    });
  });

  describe("addTime", () => {
    it("adds hours with DATE_ADD", () => {
      expect(mysqlDialect.addTime("col", "hour", "+", 5)).toBe(
        "DATE_ADD(col, INTERVAL 5 HOUR)"
      );
    });

    it("subtracts minutes with DATE_SUB", () => {
      expect(mysqlDialect.addTime("col", "minute", "-", 30)).toBe(
        "DATE_SUB(col, INTERVAL 30 MINUTE)"
      );
    });
  });

  describe("dateTrunc", () => {
    it("truncates to day using DATE()", () => {
      expect(mysqlDialect.dateTrunc("timestamp")).toBe("DATE(timestamp)");
    });
  });

  describe("dateDiff", () => {
    it("uses DATEDIFF with reversed order (end, start)", () => {
      expect(mysqlDialect.dateDiff("start_date", "end_date")).toBe(
        "DATEDIFF(end_date, start_date)"
      );
    });
  });

  describe("formatDate", () => {
    it("formats date using DATE_FORMAT", () => {
      expect(mysqlDialect.formatDate("date_col")).toBe(
        'DATE_FORMAT(date_col, "%Y-%m-%d")'
      );
    });
  });

  describe("formatDateTimeString", () => {
    it("formats datetime using DATE_FORMAT", () => {
      expect(mysqlDialect.formatDateTimeString("datetime_col")).toBe(
        'DATE_FORMAT(datetime_col, "%Y-%m-%d %H:%i:%S")'
      );
    });
  });

  describe("castToString", () => {
    it("casts using char type", () => {
      expect(mysqlDialect.castToString("numeric_col")).toBe(
        "cast(numeric_col as char)"
      );
    });
  });

  describe("ensureFloat", () => {
    it("casts to DOUBLE", () => {
      expect(mysqlDialect.ensureFloat("int_col")).toBe(
        "CAST(int_col AS DOUBLE)"
      );
    });
  });

  describe("escapeStringLiteral", () => {
    it("escapes single quotes by doubling (inherited from base)", () => {
      expect(mysqlDialect.escapeStringLiteral("it's")).toBe("it''s");
    });
  });

  describe("ifElse", () => {
    it("generates CASE WHEN expression (inherited from base)", () => {
      expect(mysqlDialect.ifElse("x > 0", "1", "0")).toBe(
        "(CASE WHEN x > 0 THEN 1 ELSE 0 END)"
      );
    });
  });

  describe("selectStarLimit", () => {
    it("generates SELECT with LIMIT", () => {
      expect(mysqlDialect.selectStarLimit("users", 10)).toBe(
        "SELECT * FROM users LIMIT 10"
      );
    });
  });

  describe("extractJSONField", () => {
    it("extracts string field with JSON_EXTRACT", () => {
      expect(
        mysqlDialect.extractJSONField("json_col", "user.name", false)
      ).toBe("JSON_EXTRACT(json_col, '$.user.name')");
    });

    it("extracts numeric field with DOUBLE cast", () => {
      expect(mysqlDialect.extractJSONField("json_col", "user.age", true)).toBe(
        "CAST(JSON_EXTRACT(json_col, '$.user.age') AS DOUBLE)"
      );
    });
  });

  describe("HLL functions", () => {
    it("does not support HLL", () => {
      expect(mysqlDialect.hasCountDistinctHLL()).toBe(false);
    });

    it("throws error for hllAggregate", () => {
      expect(() => mysqlDialect.hllAggregate("user_id")).toThrow(
        "MySQL does not support HyperLogLog"
      );
    });

    it("throws error for hllReaggregate", () => {
      expect(() => mysqlDialect.hllReaggregate("hll_col")).toThrow(
        "MySQL does not support HyperLogLog"
      );
    });

    it("throws error for hllCardinality", () => {
      expect(() => mysqlDialect.hllCardinality("hll_col")).toThrow(
        "MySQL does not support HyperLogLog"
      );
    });
  });

  describe("Quantile functions", () => {
    it("does not have efficient percentile", () => {
      expect(mysqlDialect.hasEfficientPercentile()).toBe(false);
    });

    it("does not have quantile testing", () => {
      expect(mysqlDialect.hasQuantileTesting()).toBe(false);
    });

    it("throws error for approxQuantile", () => {
      expect(() => mysqlDialect.approxQuantile("value", 0.5)).toThrow(
        "MySQL does not have a built-in approximate percentile function"
      );
    });
  });

  describe("Type guards", () => {
    it("hasHllSupport returns false for MySQL", () => {
      expect(hasHllSupport(mysqlDialect)).toBe(false);
    });

    it("hasQuantileSupport returns true for MySQL (methods exist but throw)", () => {
      // The type guard checks for method presence, not whether they work
      // MySQL has the methods but they throw when called
      expect(hasQuantileSupport(mysqlDialect)).toBe(true);
    });
  });
});
