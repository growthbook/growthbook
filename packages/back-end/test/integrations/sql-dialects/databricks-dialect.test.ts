import {
  databricksDialect,
  hasHllSupport,
  hasQuantileSupport,
} from "../../../src/integrations/sql-dialects";

describe("Databricks Dialect", () => {
  describe("formatDialect", () => {
    it("returns sql (generic formatter)", () => {
      expect(databricksDialect.formatDialect).toBe("sql");
    });
  });

  describe("toTimestamp", () => {
    it("formats date using TIMESTAMP literal", () => {
      const date = new Date("2023-01-15T12:30:45.123Z");
      expect(databricksDialect.toTimestamp(date)).toBe(
        "TIMESTAMP'2023-01-15T12:30:45.123Z'"
      );
    });
  });

  describe("addHours", () => {
    it("returns column unchanged when hours is 0", () => {
      expect(databricksDialect.addHours("timestamp", 0)).toBe("timestamp");
    });

    it("adds positive hours using timestampadd", () => {
      expect(databricksDialect.addHours("timestamp", 24)).toBe(
        "timestampadd(hour,24,timestamp)"
      );
    });

    it("subtracts negative hours using timestampadd with negative", () => {
      expect(databricksDialect.addHours("timestamp", -12)).toBe(
        "timestampadd(hour,-12,timestamp)"
      );
    });

    it("uses minutes for fractional hours", () => {
      expect(databricksDialect.addHours("timestamp", 1.5)).toBe(
        "timestampadd(minute,90,timestamp)"
      );
    });
  });

  describe("addTime", () => {
    it("adds hours with timestampadd", () => {
      expect(databricksDialect.addTime("col", "hour", "+", 5)).toBe(
        "timestampadd(hour,5,col)"
      );
    });

    it("subtracts minutes with timestampadd", () => {
      expect(databricksDialect.addTime("col", "minute", "-", 30)).toBe(
        "timestampadd(minute,-30,col)"
      );
    });
  });

  describe("dateTrunc", () => {
    it("truncates to day using date_trunc (inherited from base)", () => {
      expect(databricksDialect.dateTrunc("timestamp")).toBe(
        "date_trunc('day', timestamp)"
      );
    });
  });

  describe("dateDiff", () => {
    it("uses datediff function (inherited from base)", () => {
      expect(databricksDialect.dateDiff("start_date", "end_date")).toBe(
        "datediff(day, start_date, end_date)"
      );
    });
  });

  describe("formatDate", () => {
    it("formats date using date_format", () => {
      expect(databricksDialect.formatDate("date_col")).toBe(
        "date_format(date_col, 'y-MM-dd')"
      );
    });
  });

  describe("formatDateTimeString", () => {
    it("formats datetime using date_format with milliseconds", () => {
      expect(databricksDialect.formatDateTimeString("datetime_col")).toBe(
        "date_format(datetime_col, 'y-MM-dd HH:mm:ss.SSS')"
      );
    });
  });

  describe("castToString", () => {
    it("casts using string type", () => {
      expect(databricksDialect.castToString("numeric_col")).toBe(
        "cast(numeric_col as string)"
      );
    });
  });

  describe("ensureFloat", () => {
    it("casts to double", () => {
      expect(databricksDialect.ensureFloat("int_col")).toBe(
        "cast(int_col as double)"
      );
    });
  });

  describe("escapeStringLiteral", () => {
    it("escapes single quotes with backslash", () => {
      expect(databricksDialect.escapeStringLiteral("it's")).toBe("it\\'s");
    });

    it("escapes backslashes", () => {
      expect(databricksDialect.escapeStringLiteral("path\\to\\file")).toBe(
        "path\\\\to\\\\file"
      );
    });
  });

  describe("selectStarLimit", () => {
    it("generates SELECT with LIMIT", () => {
      expect(databricksDialect.selectStarLimit("users", 10)).toBe(
        "SELECT * FROM users LIMIT 10"
      );
    });
  });

  describe("extractJSONField", () => {
    it("extracts string field with :path syntax", () => {
      expect(
        databricksDialect.extractJSONField("json_col", "user.name", false)
      ).toBe("json_col:user.name");
    });

    it("extracts numeric field with double cast", () => {
      expect(
        databricksDialect.extractJSONField("json_col", "user.age", true)
      ).toBe("cast(json_col:user.age as double)");
    });
  });

  describe("getDataType", () => {
    it("maps string to STRING", () => {
      expect(databricksDialect.getDataType("string")).toBe("STRING");
    });

    it("maps integer to INT", () => {
      expect(databricksDialect.getDataType("integer")).toBe("INT");
    });

    it("maps float to DOUBLE", () => {
      expect(databricksDialect.getDataType("float")).toBe("DOUBLE");
    });

    it("maps hll to BINARY", () => {
      expect(databricksDialect.getDataType("hll")).toBe("BINARY");
    });
  });

  describe("HLL functions", () => {
    it("supports HLL", () => {
      expect(databricksDialect.hasCountDistinctHLL()).toBe(true);
    });

    it("aggregates with HLL_SKETCH_AGG and string cast", () => {
      expect(databricksDialect.hllAggregate("user_id")).toBe(
        "HLL_SKETCH_AGG(cast(user_id as string))"
      );
    });

    it("reaggregates with HLL_UNION_AGG", () => {
      expect(databricksDialect.hllReaggregate("hll_col")).toBe(
        "HLL_UNION_AGG(hll_col)"
      );
    });

    it("extracts cardinality with HLL_SKETCH_ESTIMATE", () => {
      expect(databricksDialect.hllCardinality("hll_col")).toBe(
        "HLL_SKETCH_ESTIMATE(hll_col)"
      );
    });

    it("casts to HLL data type (BINARY)", () => {
      expect(databricksDialect.castToHllDataType("col")).toBe(
        "CAST(col AS BINARY)"
      );
    });
  });

  describe("Quantile functions", () => {
    it("has efficient percentile", () => {
      expect(databricksDialect.hasEfficientPercentile()).toBe(true);
    });

    it("has quantile testing", () => {
      expect(databricksDialect.hasQuantileTesting()).toBe(true);
    });

    it("generates APPROX_PERCENTILE for numeric quantile", () => {
      expect(databricksDialect.approxQuantile("value", 0.5)).toBe(
        "APPROX_PERCENTILE(value, 0.5)"
      );
    });
  });

  describe("Type guards", () => {
    it("hasHllSupport returns true for Databricks", () => {
      expect(hasHllSupport(databricksDialect)).toBe(true);
    });

    it("hasQuantileSupport returns true for Databricks", () => {
      expect(hasQuantileSupport(databricksDialect)).toBe(true);
    });
  });
});
