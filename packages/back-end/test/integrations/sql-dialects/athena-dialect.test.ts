import {
  athenaDialect,
  hasHllSupport,
  hasQuantileSupport,
} from "../../../src/integrations/sql-dialects";

describe("Athena Dialect", () => {
  describe("formatDialect", () => {
    it("returns trino", () => {
      expect(athenaDialect.formatDialect).toBe("trino");
    });
  });

  describe("toTimestamp", () => {
    it("formats date using from_iso8601_timestamp", () => {
      const date = new Date("2023-01-15T12:30:45.123Z");
      expect(athenaDialect.toTimestamp(date)).toBe(
        "from_iso8601_timestamp('2023-01-15T12:30:45.123Z')"
      );
    });

    it("handles midnight correctly", () => {
      const date = new Date("2023-01-01T00:00:00.000Z");
      expect(athenaDialect.toTimestamp(date)).toBe(
        "from_iso8601_timestamp('2023-01-01T00:00:00.000Z')"
      );
    });
  });

  describe("addHours", () => {
    it("returns column unchanged when hours is 0", () => {
      expect(athenaDialect.addHours("timestamp", 0)).toBe("timestamp");
    });

    it("adds positive hours using INTERVAL syntax without s", () => {
      expect(athenaDialect.addHours("timestamp", 24)).toBe(
        "timestamp + INTERVAL '24' hour"
      );
    });

    it("subtracts negative hours", () => {
      expect(athenaDialect.addHours("timestamp", -12)).toBe(
        "timestamp - INTERVAL '12' hour"
      );
    });

    it("uses minutes for fractional hours", () => {
      expect(athenaDialect.addHours("timestamp", 1.5)).toBe(
        "timestamp + INTERVAL '90' minute"
      );
    });
  });

  describe("addTime", () => {
    it("adds hours with INTERVAL syntax (no s on unit)", () => {
      expect(athenaDialect.addTime("col", "hour", "+", 5)).toBe(
        "col + INTERVAL '5' hour"
      );
    });

    it("subtracts minutes with INTERVAL syntax", () => {
      expect(athenaDialect.addTime("col", "minute", "-", 30)).toBe(
        "col - INTERVAL '30' minute"
      );
    });
  });

  describe("dateTrunc", () => {
    it("truncates to day using date_trunc (inherited from base)", () => {
      expect(athenaDialect.dateTrunc("timestamp")).toBe(
        "date_trunc('day', timestamp)"
      );
    });
  });

  describe("dateDiff", () => {
    it("uses date_diff function with day unit", () => {
      expect(athenaDialect.dateDiff("start_date", "end_date")).toBe(
        "date_diff('day', start_date, end_date)"
      );
    });
  });

  describe("formatDate", () => {
    it("formats date using to_iso8601 and substr", () => {
      expect(athenaDialect.formatDate("date_col")).toBe(
        "substr(to_iso8601(date_col),1,10)"
      );
    });
  });

  describe("formatDateTimeString", () => {
    it("formats datetime using to_iso8601", () => {
      expect(athenaDialect.formatDateTimeString("datetime_col")).toBe(
        "to_iso8601(datetime_col)"
      );
    });
  });

  describe("ensureFloat", () => {
    it("casts to double", () => {
      expect(athenaDialect.ensureFloat("int_col")).toBe(
        "CAST(int_col AS double)"
      );
    });
  });

  describe("escapeStringLiteral", () => {
    it("escapes single quotes by doubling (inherited from base)", () => {
      expect(athenaDialect.escapeStringLiteral("it's")).toBe("it''s");
    });
  });

  describe("selectStarLimit", () => {
    it("generates SELECT with LIMIT", () => {
      expect(athenaDialect.selectStarLimit("users", 10)).toBe(
        "SELECT * FROM users LIMIT 10"
      );
    });
  });

  describe("extractJSONField", () => {
    it("extracts field using json_extract_scalar (inherited from base)", () => {
      expect(
        athenaDialect.extractJSONField("json_col", "user.name", false)
      ).toBe("json_extract_scalar(json_col, '$.user.name')");
    });

    it("extracts numeric field with ensureFloat", () => {
      expect(
        athenaDialect.extractJSONField("json_col", "user.age", true)
      ).toBe("CAST(json_extract_scalar(json_col, '$.user.age') AS double)");
    });
  });

  describe("HLL functions", () => {
    it("supports HLL", () => {
      expect(athenaDialect.hasCountDistinctHLL()).toBe(true);
    });

    it("aggregates with APPROX_SET", () => {
      expect(athenaDialect.hllAggregate("user_id")).toBe("APPROX_SET(user_id)");
    });

    it("reaggregates with MERGE", () => {
      expect(athenaDialect.hllReaggregate("hll_col")).toBe("MERGE(hll_col)");
    });

    it("extracts cardinality with CARDINALITY", () => {
      expect(athenaDialect.hllCardinality("hll_col")).toBe(
        "CARDINALITY(hll_col)"
      );
    });

    it("casts to HLL data type (HyperLogLog)", () => {
      expect(athenaDialect.castToHllDataType("col")).toBe(
        "CAST(col AS HyperLogLog)"
      );
    });
  });

  describe("Quantile functions", () => {
    it("has efficient percentile", () => {
      expect(athenaDialect.hasEfficientPercentile()).toBe(true);
    });

    it("has quantile testing", () => {
      expect(athenaDialect.hasQuantileTesting()).toBe(true);
    });

    it("generates APPROX_PERCENTILE for numeric quantile", () => {
      expect(athenaDialect.approxQuantile("value", 0.5)).toBe(
        "APPROX_PERCENTILE(value, 0.5)"
      );
    });

    it("generates APPROX_PERCENTILE for string quantile expression", () => {
      expect(athenaDialect.approxQuantile("value", "q")).toBe(
        "APPROX_PERCENTILE(value, q)"
      );
    });
  });

  describe("Type guards", () => {
    it("hasHllSupport returns true for Athena", () => {
      expect(hasHllSupport(athenaDialect)).toBe(true);
    });

    it("hasQuantileSupport returns true for Athena", () => {
      expect(hasQuantileSupport(athenaDialect)).toBe(true);
    });
  });
});
