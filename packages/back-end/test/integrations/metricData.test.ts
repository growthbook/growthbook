import { FactMetricInterface } from "shared/types/fact-table";
import { bigQueryDialect } from "back-end/src/integrations/dialects/bigquery";
import { getMetricData } from "back-end/src/integrations/sql/fact-metrics/metric-data";
import { factMetricFactory } from "../factories/FactMetric.factory";
import { factTableFactory } from "../factories/FactTable.factory";

describe("getMetricData uncapped expressions", () => {
  const cases: {
    name: string;
    metricType: "mean" | "ratio";
    upper: FactMetricInterface["cappingSettings"];
    lower: FactMetricInterface["lowerCappingSettings"];
  }[] = [
    {
      name: "zero absolute floor",
      metricType: "mean",
      upper: { type: "", value: 0 },
      lower: { type: "absolute", value: 0 },
    },
    {
      name: "negative absolute floor and absolute ceiling",
      metricType: "mean",
      upper: { type: "absolute", value: 100 },
      lower: { type: "absolute", value: -10 },
    },
    {
      name: "absolute floor and percentile ceiling",
      metricType: "mean",
      upper: { type: "percentile", value: 0.99 },
      lower: { type: "absolute", value: -10 },
    },
    {
      name: "ratio with only a percentile floor",
      metricType: "ratio",
      upper: { type: "", value: 0 },
      lower: { type: "percentile", value: 0.05 },
    },
    {
      name: "ratio with both percentile tails",
      metricType: "ratio",
      upper: { type: "percentile", value: 0.99 },
      lower: { type: "percentile", value: 0.05 },
    },
  ];

  it.each(cases)(
    "removes both caps for $name",
    ({ metricType, upper, lower }) => {
      const numeratorTable = factTableFactory.build({ id: "ft_numerator" });
      const denominatorTable = factTableFactory.build({ id: "ft_denominator" });
      const metric = factMetricFactory.build({
        metricType,
        numerator: { factTableId: numeratorTable.id },
        denominator:
          metricType === "ratio" ? { factTableId: denominatorTable.id } : null,
        cappingSettings: upper,
        lowerCappingSettings: lower,
        regressionAdjustmentEnabled: true,
      });

      const data = getMetricData(
        bigQueryDialect,
        { metric, index: 0 },
        {
          attributionModel: "firstExposure",
          regressionAdjustmentEnabled: true,
          startDate: new Date("2026-01-01"),
          endDate: new Date("2026-02-01"),
        },
        null,
        [
          { factTable: numeratorTable, index: 0 },
          { factTable: denominatorTable, index: 1 },
        ],
        "cov",
        "m0",
      );

      expect(data.computeUncappedMetric).toBe(true);
      expect(data.regressionAdjusted).toBe(true);
      expect(data.uncappedCoalesceMetric).toBe(
        "CAST(COALESCE(m.m0_value, 0) AS FLOAT64)",
      );
      expect(data.uncappedCoalesceCovariate).toBe(
        "CAST(COALESCE(cov.m0_covariate_value, 0) AS FLOAT64)",
      );
      expect(data.capCoalesceMetric).toContain("GREATEST(");
      expect(data.capCoalesceCovariate).toContain("GREATEST(");

      if (metricType === "ratio") {
        expect(data.uncappedCoalesceDenominator).toBe(
          "CAST(COALESCE(m1.m0_denominator, 0) AS FLOAT64)",
        );
        expect(data.uncappedCoalesceDenominatorCovariate).toBe(
          "CAST(COALESCE(cov1.m0_covariate_denominator, 0) AS FLOAT64)",
        );
        expect(data.capCoalesceDenominator).toContain("GREATEST(");
        expect(data.capCoalesceDenominatorCovariate).toContain("GREATEST(");
      }

      expect(metric.cappingSettings).toMatchObject(upper);
      expect(metric.lowerCappingSettings).toEqual(lower);
    },
  );
});
