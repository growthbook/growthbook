import {
  prestoDialect,
  hasHllSupport,
  hasQuantileSupport,
} from "../../../src/integrations/sql-dialects";

describe("Presto Dialect", () => {
  describe("formatDialect", () => {
    it("returns trino", () => {
      expect(prestoDialect.formatDialect).toBe("trino");
    });
  });

  describe("toTimestamp", () => {
    it("formats date using from_iso8601_timestamp", () => {
      const date = new Date("2023-01-15T12:30:45.123Z");
      expect(prestoDialect.toTimestamp(date)).toBe(
        "from_iso8601_timestamp('2023-01-15T12:30:45.123Z')"
      );
    });
  });

  describe("addHours", () => {
    it("returns column unchanged when hours is 0", () => {
      expect(prestoDialect.addHours("timestamp", 0)).toBe("timestamp");
    });

    it("adds positive hours using INTERVAL syntax without s", () => {
      expect(prestoDialect.addHours("timestamp", 24)).toBe(
        "timestamp + INTERVAL '24' hour"
      );
    });
  });

  describe("addTime", () => {
    it("adds hours with INTERVAL syntax (no s on unit)", () => {
      expect(prestoDialect.addTime("col", "hour", "+", 5)).toBe(
        "col + INTERVAL '5' hour"
      );
    });

    it("subtracts minutes with INTERVAL syntax", () => {
      expect(prestoDialect.addTime("col", "minute", "-", 30)).toBe(
        "col - INTERVAL '30' minute"
      );
    });
  });

  describe("dateTrunc", () => {
    it("truncates to day using date_trunc (inherited from base)", () => {
      expect(prestoDialect.dateTrunc("timestamp")).toBe(
        "date_trunc('day', timestamp)"
      );
    });
  });

  describe("dateDiff", () => {
    it("uses date_diff function with day unit", () => {
      expect(prestoDialect.dateDiff("start_date", "end_date")).toBe(
        "date_diff('day', start_date, end_date)"
      );
    });
  });

  describe("formatDate", () => {
    it("formats date using to_iso8601 and substr", () => {
      expect(prestoDialect.formatDate("date_col")).toBe(
        "substr(to_iso8601(date_col),1,10)"
      );
    });
  });

  describe("formatDateTimeString", () => {
    it("formats datetime using to_iso8601", () => {
      expect(prestoDialect.formatDateTimeString("datetime_col")).toBe(
        "to_iso8601(datetime_col)"
      );
    });
  });

  describe("ensureFloat", () => {
    it("casts to DOUBLE", () => {
      expect(prestoDialect.ensureFloat("int_col")).toBe(
        "CAST(int_col AS DOUBLE)"
      );
    });
  });

  describe("selectStarLimit", () => {
    it("generates SELECT with LIMIT", () => {
      expect(prestoDialect.selectStarLimit("users", 10)).toBe(
        "SELECT * FROM users LIMIT 10"
      );
    });
  });

  describe("HLL functions", () => {
    it("supports HLL", () => {
      expect(prestoDialect.hasCountDistinctHLL()).toBe(true);
    });

    it("aggregates with APPROX_SET", () => {
      expect(prestoDialect.hllAggregate("user_id")).toBe("APPROX_SET(user_id)");
    });

    it("reaggregates with MERGE and HyperLogLog cast", () => {
      expect(prestoDialect.hllReaggregate("hll_col")).toBe(
        "MERGE(CAST(hll_col AS HyperLogLog))"
      );
    });

    it("extracts cardinality with CARDINALITY", () => {
      expect(prestoDialect.hllCardinality("hll_col")).toBe(
        "CARDINALITY(hll_col)"
      );
    });

    it("casts to HLL data type (HyperLogLog)", () => {
      expect(prestoDialect.castToHllDataType("col")).toBe(
        "CAST(col AS HyperLogLog)"
      );
    });
  });

  describe("Quantile functions", () => {
    it("has efficient percentile", () => {
      expect(prestoDialect.hasEfficientPercentile()).toBe(true);
    });

    it("has quantile testing", () => {
      expect(prestoDialect.hasQuantileTesting()).toBe(true);
    });

    it("generates APPROX_PERCENTILE for numeric quantile", () => {
      expect(prestoDialect.approxQuantile("value", 0.5)).toBe(
        "APPROX_PERCENTILE(value, 0.5)"
      );
    });
  });

  describe("Type guards", () => {
    it("hasHllSupport returns true for Presto", () => {
      expect(hasHllSupport(prestoDialect)).toBe(true);
    });

    it("hasQuantileSupport returns true for Presto", () => {
      expect(hasQuantileSupport(prestoDialect)).toBe(true);
    });
  });
});
