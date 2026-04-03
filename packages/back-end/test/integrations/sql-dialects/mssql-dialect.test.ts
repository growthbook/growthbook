import {
  mssqlDialect,
  hasHllSupport,
  hasQuantileSupport,
} from "../../../src/integrations/sql-dialects";

describe("MSSQL Dialect", () => {
  describe("formatDialect", () => {
    it("returns tsql", () => {
      expect(mssqlDialect.formatDialect).toBe("tsql");
    });
  });

  describe("toTimestamp", () => {
    it("formats date without milliseconds (inherited from base)", () => {
      const date = new Date("2023-01-15T12:30:45.123Z");
      expect(mssqlDialect.toTimestamp(date)).toBe("'2023-01-15 12:30:45'");
    });
  });

  describe("addHours", () => {
    it("returns column unchanged when hours is 0", () => {
      expect(mssqlDialect.addHours("timestamp", 0)).toBe("timestamp");
    });

    it("adds positive hours using DATEADD", () => {
      expect(mssqlDialect.addHours("timestamp", 24)).toBe(
        "DATEADD(hour, 24, timestamp)"
      );
    });

    it("subtracts negative hours using DATEADD with negative", () => {
      expect(mssqlDialect.addHours("timestamp", -12)).toBe(
        "DATEADD(hour, -12, timestamp)"
      );
    });

    it("uses minutes for fractional hours", () => {
      expect(mssqlDialect.addHours("timestamp", 1.5)).toBe(
        "DATEADD(minute, 90, timestamp)"
      );
    });
  });

  describe("addTime", () => {
    it("adds hours with DATEADD", () => {
      expect(mssqlDialect.addTime("col", "hour", "+", 5)).toBe(
        "DATEADD(hour, 5, col)"
      );
    });

    it("subtracts minutes with DATEADD and negative", () => {
      expect(mssqlDialect.addTime("col", "minute", "-", 30)).toBe(
        "DATEADD(minute, -30, col)"
      );
    });
  });

  describe("dateTrunc", () => {
    it("truncates to day using cast as DATE", () => {
      expect(mssqlDialect.dateTrunc("timestamp")).toBe("cast(timestamp as DATE)");
    });
  });

  describe("dateDiff", () => {
    it("uses datediff function (inherited from base)", () => {
      expect(mssqlDialect.dateDiff("start_date", "end_date")).toBe(
        "datediff(day, start_date, end_date)"
      );
    });
  });

  describe("formatDate", () => {
    it("formats date using FORMAT", () => {
      expect(mssqlDialect.formatDate("date_col")).toBe(
        "FORMAT(date_col, 'yyyy-MM-dd')"
      );
    });
  });

  describe("formatDateTimeString", () => {
    it("formats datetime using CONVERT with style 121", () => {
      expect(mssqlDialect.formatDateTimeString("datetime_col")).toBe(
        "CONVERT(VARCHAR(25), datetime_col, 121)"
      );
    });
  });

  describe("castToString", () => {
    it("casts using varchar(256)", () => {
      expect(mssqlDialect.castToString("numeric_col")).toBe(
        "cast(numeric_col as varchar(256))"
      );
    });
  });

  describe("ensureFloat", () => {
    it("casts to FLOAT", () => {
      expect(mssqlDialect.ensureFloat("int_col")).toBe("CAST(int_col as FLOAT)");
    });
  });

  describe("escapeStringLiteral", () => {
    it("escapes single quotes by doubling (inherited from base)", () => {
      expect(mssqlDialect.escapeStringLiteral("it's")).toBe("it''s");
    });
  });

  describe("ifElse", () => {
    it("generates CASE WHEN expression (inherited from base)", () => {
      expect(mssqlDialect.ifElse("x > 0", "1", "0")).toBe(
        "(CASE WHEN x > 0 THEN 1 ELSE 0 END)"
      );
    });
  });

  describe("evalBoolean", () => {
    it("evaluates true using = 1", () => {
      expect(mssqlDialect.evalBoolean("active", true)).toBe("active = 1");
    });

    it("evaluates false using = 0", () => {
      expect(mssqlDialect.evalBoolean("active", false)).toBe("active = 0");
    });
  });

  describe("selectStarLimit", () => {
    it("generates SELECT TOP instead of LIMIT", () => {
      expect(mssqlDialect.selectStarLimit("users", 10)).toBe(
        "SELECT TOP 10 * FROM users"
      );
    });
  });

  describe("extractJSONField", () => {
    it("extracts string field with JSON_VALUE", () => {
      expect(
        mssqlDialect.extractJSONField("json_col", "user.name", false)
      ).toBe("JSON_VALUE(json_col, '$.user.name')");
    });

    it("extracts numeric field with FLOAT cast", () => {
      expect(mssqlDialect.extractJSONField("json_col", "user.age", true)).toBe(
        "CAST(JSON_VALUE(json_col, '$.user.age') as FLOAT)"
      );
    });
  });

  describe("HLL functions", () => {
    it("does not support HLL", () => {
      expect(mssqlDialect.hasCountDistinctHLL()).toBe(false);
    });

    it("throws error for hllAggregate", () => {
      expect(() => mssqlDialect.hllAggregate("user_id")).toThrow(
        "MSSQL does not support HyperLogLog"
      );
    });

    it("throws error for hllReaggregate", () => {
      expect(() => mssqlDialect.hllReaggregate("hll_col")).toThrow(
        "MSSQL does not support HyperLogLog"
      );
    });

    it("throws error for hllCardinality", () => {
      expect(() => mssqlDialect.hllCardinality("hll_col")).toThrow(
        "MSSQL does not support HyperLogLog"
      );
    });
  });

  describe("Quantile functions", () => {
    it("has efficient percentile", () => {
      expect(mssqlDialect.hasEfficientPercentile()).toBe(true);
    });

    it("has quantile testing", () => {
      expect(mssqlDialect.hasQuantileTesting()).toBe(true);
    });

    it("generates APPROX_PERCENTILE_CONT for numeric quantile", () => {
      expect(mssqlDialect.approxQuantile("value", 0.5)).toBe(
        "APPROX_PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY value)"
      );
    });

    it("generates APPROX_PERCENTILE_CONT for string quantile expression", () => {
      expect(mssqlDialect.approxQuantile("value", "q")).toBe(
        "APPROX_PERCENTILE_CONT(q) WITHIN GROUP (ORDER BY value)"
      );
    });
  });

  describe("Type guards", () => {
    it("hasHllSupport returns false for MSSQL", () => {
      expect(hasHllSupport(mssqlDialect)).toBe(false);
    });

    it("hasQuantileSupport returns true for MSSQL", () => {
      expect(hasQuantileSupport(mssqlDialect)).toBe(true);
    });
  });
});
