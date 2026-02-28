import {
  redshiftDialect,
  hasHllSupport,
  hasQuantileSupport,
} from "../../../src/integrations/sql-dialects";

describe("Redshift Dialect", () => {
  describe("formatDialect", () => {
    it("returns redshift", () => {
      expect(redshiftDialect.formatDialect).toBe("redshift");
    });
  });

  describe("toTimestamp", () => {
    it("formats date without milliseconds (inherited from base)", () => {
      const date = new Date("2023-01-15T12:30:45.123Z");
      expect(redshiftDialect.toTimestamp(date)).toBe("'2023-01-15 12:30:45'");
    });
  });

  describe("addHours", () => {
    it("returns column unchanged when hours is 0", () => {
      expect(redshiftDialect.addHours("timestamp", 0)).toBe("timestamp");
    });

    it("adds positive hours using INTERVAL syntax", () => {
      expect(redshiftDialect.addHours("timestamp", 24)).toBe(
        "timestamp + INTERVAL '24 hours'"
      );
    });
  });

  describe("addTime", () => {
    it("adds hours with INTERVAL syntax", () => {
      expect(redshiftDialect.addTime("col", "hour", "+", 5)).toBe(
        "col + INTERVAL '5 hours'"
      );
    });

    it("subtracts minutes with INTERVAL syntax", () => {
      expect(redshiftDialect.addTime("col", "minute", "-", 30)).toBe(
        "col - INTERVAL '30 minutes'"
      );
    });
  });

  describe("dateTrunc", () => {
    it("truncates to day using date_trunc", () => {
      expect(redshiftDialect.dateTrunc("timestamp")).toBe(
        "date_trunc('day', timestamp)"
      );
    });
  });

  describe("dateDiff", () => {
    it("uses datediff function (inherited from base)", () => {
      expect(redshiftDialect.dateDiff("start_date", "end_date")).toBe(
        "datediff(day, start_date, end_date)"
      );
    });
  });

  describe("formatDate", () => {
    it("formats date with to_char YYYY-MM-DD", () => {
      expect(redshiftDialect.formatDate("date_col")).toBe(
        "to_char(date_col, 'YYYY-MM-DD')"
      );
    });
  });

  describe("formatDateTimeString", () => {
    it("formats datetime with to_char including milliseconds", () => {
      expect(redshiftDialect.formatDateTimeString("datetime_col")).toBe(
        "to_char(datetime_col, 'YYYY-MM-DD HH24:MI:SS.MS')"
      );
    });
  });

  describe("ensureFloat", () => {
    it("casts using :: syntax", () => {
      expect(redshiftDialect.ensureFloat("int_col")).toBe("int_col::float");
    });
  });

  describe("escapeStringLiteral", () => {
    it("escapes single quotes by doubling", () => {
      expect(redshiftDialect.escapeStringLiteral("it's")).toBe("it''s");
    });
  });

  describe("selectStarLimit", () => {
    it("generates SELECT with LIMIT", () => {
      expect(redshiftDialect.selectStarLimit("users", 10)).toBe(
        "SELECT * FROM users LIMIT 10"
      );
    });
  });

  describe("extractJSONField", () => {
    it("extracts string field with JSON_EXTRACT_PATH_TEXT and TRUE", () => {
      expect(
        redshiftDialect.extractJSONField("json_col", "user.name", false)
      ).toBe("JSON_EXTRACT_PATH_TEXT(json_col, 'user', 'name', TRUE)");
    });

    it("extracts numeric field with float cast", () => {
      expect(
        redshiftDialect.extractJSONField("json_col", "user.age", true)
      ).toBe("JSON_EXTRACT_PATH_TEXT(json_col, 'user', 'age', TRUE)::float");
    });

    it("handles single-level paths", () => {
      expect(redshiftDialect.extractJSONField("json_col", "name", false)).toBe(
        "JSON_EXTRACT_PATH_TEXT(json_col, 'name', TRUE)"
      );
    });
  });

  describe("HLL functions", () => {
    it("supports HLL", () => {
      expect(redshiftDialect.hasCountDistinctHLL()).toBe(true);
    });

    it("aggregates with HLL_CREATE_SKETCH", () => {
      expect(redshiftDialect.hllAggregate("user_id")).toBe(
        "HLL_CREATE_SKETCH(user_id)"
      );
    });

    it("reaggregates with HLL_COMBINE", () => {
      expect(redshiftDialect.hllReaggregate("hll_col")).toBe(
        "HLL_COMBINE(hll_col)"
      );
    });

    it("extracts cardinality with HLL_CARDINALITY", () => {
      expect(redshiftDialect.hllCardinality("hll_col")).toBe(
        "HLL_CARDINALITY(hll_col)"
      );
    });

    it("casts to HLL data type (HLLSKETCH)", () => {
      expect(redshiftDialect.castToHllDataType("col")).toBe(
        "CAST(col AS HLLSKETCH)"
      );
    });
  });

  describe("Quantile functions", () => {
    it("does not have efficient percentile", () => {
      expect(redshiftDialect.hasEfficientPercentile()).toBe(false);
    });

    it("has quantile testing", () => {
      expect(redshiftDialect.hasQuantileTesting()).toBe(true);
    });

    it("generates PERCENTILE_CONT for numeric quantile", () => {
      expect(redshiftDialect.approxQuantile("value", 0.5)).toBe(
        "PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY value)"
      );
    });

    it("generates PERCENTILE_CONT for string quantile expression", () => {
      expect(redshiftDialect.approxQuantile("value", "q")).toBe(
        "PERCENTILE_CONT(q) WITHIN GROUP (ORDER BY value)"
      );
    });
  });

  describe("Type guards", () => {
    it("hasHllSupport returns true for Redshift", () => {
      expect(hasHllSupport(redshiftDialect)).toBe(true);
    });

    it("hasQuantileSupport returns true for Redshift", () => {
      expect(hasQuantileSupport(redshiftDialect)).toBe(true);
    });
  });
});
