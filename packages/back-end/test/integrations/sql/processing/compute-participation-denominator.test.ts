import type { FactMetricInterface } from "shared/types/fact-table";
import type { SqlDialect } from "shared/types/sql";
import { mysqlDialect, postgresDialect } from "shared/dialects";
import { computeParticipationDenominator } from "back-end/src/integrations/sql/processing/compute-participation-denominator";

type WindowSettings = FactMetricInterface["windowSettings"];

function makeMetric(windowSettings: Partial<WindowSettings>) {
  return {
    windowSettings: {
      type: "",
      windowValue: 0,
      windowUnit: "days",
      delayValue: 0,
      delayUnit: "hours",
      ...windowSettings,
    },
  } as unknown as FactMetricInterface;
}

const analysisEndDate = new Date("2026-09-28T00:00:00Z");

function run(
  dialect: SqlDialect,
  windowSettings: Partial<WindowSettings>,
  overrideConversionWindows = false,
) {
  return computeParticipationDenominator(dialect, {
    initialTimestampColumn: "first_exposure_timestamp",
    analysisEndDate,
    metric: makeMetric(windowSettings),
    overrideConversionWindows,
  });
}

describe("computeParticipationDenominator", () => {
  // Regression: the denominator used the generic castToTimestamp primitive,
  // which always emits CAST(... AS TIMESTAMP). That is a syntax error on
  // MySQL / StarRocks, which require CAST(... AS DATETIME).
  describe("uses the dialect's timestamp cast", () => {
    const windowCases: [string, Partial<WindowSettings>][] = [
      ["no window", { type: "" }],
      ["lookback window", { type: "lookback", windowValue: 7 }],
      ["conversion window", { type: "conversion", windowValue: 3 }],
      ["delay", { type: "", delayValue: 2, delayUnit: "hours" }],
    ];

    it.each(windowCases)("mysql: %s", (_label, windowSettings) => {
      const sql = run(mysqlDialect, windowSettings);
      expect(sql).not.toMatch(/AS TIMESTAMP/i);
      expect(sql).toMatch(/AS DATETIME/);
      expect(sql).toContain("DATEDIFF(");
    });

    it("mysql: casts the exposure column with DATETIME", () => {
      expect(run(mysqlDialect, { type: "" })).toContain(
        "CAST(first_exposure_timestamp AS DATETIME)",
      );
    });

    it("postgres: still casts with TIMESTAMP", () => {
      const sql = run(postgresDialect, { type: "lookback", windowValue: 7 });
      expect(sql).toMatch(/AS TIMESTAMP/);
      expect(sql).not.toMatch(/AS DATETIME/);
    });
  });
});
