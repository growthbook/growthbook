import {
  clickhouseDialect,
  hasHllSupport,
  hasQuantileSupport,
} from "../../../src/integrations/sql-dialects";

describe("ClickHouse Dialect", () => {
  describe("formatDialect", () => {
    it("returns empty string (no dedicated formatter)", () => {
      expect(clickhouseDialect.formatDialect).toBe("");
    });
  });

  describe("toTimestamp", () => {
    it("formats date using toDateTime with UTC", () => {
      const date = new Date("2023-01-15T12:30:45.123Z");
      expect(clickhouseDialect.toTimestamp(date)).toBe(
        "toDateTime('2023-01-15 12:30:45', 'UTC')"
      );
    });

    it("handles midnight correctly", () => {
      const date = new Date("2023-01-01T00:00:00.000Z");
      expect(clickhouseDialect.toTimestamp(date)).toBe(
        "toDateTime('2023-01-01 00:00:00', 'UTC')"
      );
    });
  });

  describe("addHours", () => {
    it("returns column unchanged when hours is 0", () => {
      expect(clickhouseDialect.addHours("timestamp", 0)).toBe("timestamp");
    });

    it("adds positive hours using dateAdd", () => {
      expect(clickhouseDialect.addHours("timestamp", 24)).toBe(
        "dateAdd(hour, 24, timestamp)"
      );
    });

    it("subtracts negative hours using dateSub", () => {
      expect(clickhouseDialect.addHours("timestamp", -12)).toBe(
        "dateSub(hour, 12, timestamp)"
      );
    });

    it("uses minutes for fractional hours", () => {
      expect(clickhouseDialect.addHours("timestamp", 1.5)).toBe(
        "dateAdd(minute, 90, timestamp)"
      );
    });
  });

  describe("addTime", () => {
    it("adds hours with dateAdd", () => {
      expect(clickhouseDialect.addTime("col", "hour", "+", 5)).toBe(
        "dateAdd(hour, 5, col)"
      );
    });

    it("subtracts minutes with dateSub", () => {
      expect(clickhouseDialect.addTime("col", "minute", "-", 30)).toBe(
        "dateSub(minute, 30, col)"
      );
    });
  });

  describe("dateTrunc", () => {
    it("truncates to day using dateTrunc (lowercase)", () => {
      expect(clickhouseDialect.dateTrunc("timestamp")).toBe(
        "dateTrunc('day', timestamp)"
      );
    });
  });

  describe("dateDiff", () => {
    it("uses dateDiff function with day unit", () => {
      expect(clickhouseDialect.dateDiff("start_date", "end_date")).toBe(
        "dateDiff('day', start_date, end_date)"
      );
    });
  });

  describe("formatDate", () => {
    it("formats date using formatDateTime with %F", () => {
      expect(clickhouseDialect.formatDate("date_col")).toBe(
        "formatDateTime(date_col, '%F')"
      );
    });
  });

  describe("formatDateTimeString", () => {
    it("formats datetime using formatDateTime with full format", () => {
      expect(clickhouseDialect.formatDateTimeString("datetime_col")).toBe(
        "formatDateTime(datetime_col, '%Y-%m-%d %H:%i:%S.%f')"
      );
    });
  });

  describe("castToDate", () => {
    it("casts to DATE", () => {
      expect(clickhouseDialect.castToDate("col")).toBe("CAST(col AS DATE)");
    });

    it("uses Nullable(DATE) for NULL", () => {
      expect(clickhouseDialect.castToDate("NULL")).toBe(
        "CAST(NULL AS Nullable(DATE))"
      );
    });
  });

  describe("castToString", () => {
    it("casts using toString", () => {
      expect(clickhouseDialect.castToString("numeric_col")).toBe(
        "toString(numeric_col)"
      );
    });
  });

  describe("ensureFloat", () => {
    it("casts using toFloat64", () => {
      expect(clickhouseDialect.ensureFloat("int_col")).toBe(
        "toFloat64(int_col)"
      );
    });
  });

  describe("ifElse", () => {
    it("generates if() expression instead of CASE WHEN", () => {
      expect(clickhouseDialect.ifElse("x > 0", "1", "0")).toBe(
        "if(x > 0, 1, 0)"
      );
    });
  });

  describe("evalBoolean", () => {
    it("evaluates true using equality", () => {
      expect(clickhouseDialect.evalBoolean("active", true)).toBe(
        "active = true"
      );
    });

    it("evaluates false using equality", () => {
      expect(clickhouseDialect.evalBoolean("active", false)).toBe(
        "active = false"
      );
    });
  });

  describe("selectStarLimit", () => {
    it("generates SELECT with LIMIT", () => {
      expect(clickhouseDialect.selectStarLimit("users", 10)).toBe(
        "SELECT * FROM users LIMIT 10"
      );
    });
  });

  describe("extractJSONField", () => {
    it("extracts numeric field with if/JSONExtractFloat", () => {
      const result = clickhouseDialect.extractJSONField(
        "json_col",
        "user.age",
        true
      );
      expect(result).toContain("JSONExtractFloat");
      expect(result).toContain("toFloat64");
    });

    it("extracts string field with if/JSONExtractString", () => {
      const result = clickhouseDialect.extractJSONField(
        "json_col",
        "user.name",
        false
      );
      expect(result).toContain("JSONExtractString");
      expect(result).toContain(":String");
    });
  });

  describe("HLL functions", () => {
    it("supports HLL", () => {
      expect(clickhouseDialect.hasCountDistinctHLL()).toBe(true);
    });

    it("aggregates with uniqState", () => {
      expect(clickhouseDialect.hllAggregate("user_id")).toBe(
        "uniqState(user_id)"
      );
    });

    it("reaggregates with uniqMergeState", () => {
      expect(clickhouseDialect.hllReaggregate("hll_col")).toBe(
        "uniqMergeState(hll_col)"
      );
    });

    it("extracts cardinality with finalizeAggregation", () => {
      expect(clickhouseDialect.hllCardinality("hll_col")).toBe(
        "finalizeAggregation(hll_col)"
      );
    });
  });

  describe("Quantile functions", () => {
    it("has efficient percentile", () => {
      expect(clickhouseDialect.hasEfficientPercentile()).toBe(true);
    });

    it("has quantile testing", () => {
      expect(clickhouseDialect.hasQuantileTesting()).toBe(true);
    });

    it("generates quantile() for numeric quantile", () => {
      expect(clickhouseDialect.approxQuantile("value", 0.5)).toBe(
        "quantile(0.5)(value)"
      );
    });

    it("generates quantile() for string quantile expression", () => {
      expect(clickhouseDialect.approxQuantile("value", "q")).toBe(
        "quantile(q)(value)"
      );
    });
  });

  describe("Type guards", () => {
    it("hasHllSupport returns true for ClickHouse", () => {
      expect(hasHllSupport(clickhouseDialect)).toBe(true);
    });

    it("hasQuantileSupport returns true for ClickHouse", () => {
      expect(hasQuantileSupport(clickhouseDialect)).toBe(true);
    });
  });
});
