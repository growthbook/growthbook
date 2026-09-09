import { FactMetricInterface } from "shared/types/fact-table";
import { formatNumber, getExperimentMetricFormatter } from "@/services/metrics";

describe("metrics service", () => {
  describe("formatNumber", () => {
    it("formats small numbers without compact notation", () => {
      expect(formatNumber(123)).toBe("123");
      expect(formatNumber(1234)).toBe("1,234");
      expect(formatNumber(9999)).toBe("9,999");
    });

    it("formats large numbers when compact notation is passed in options", () => {
      const result = formatNumber(12345, { notation: "compact" });
      expect(result).toMatch(/12\.?3?K/i);
    });

    it("formats decimal numbers correctly", () => {
      expect(formatNumber(1.234)).toBe("1.234");
      expect(formatNumber(123.456)).toBe("123.5");
      expect(formatNumber(1234.5678)).toBe("1,235");
    });
  });

  describe("getExperimentMetricFormatter for ratio metrics", () => {
    const mockGetFactTableById = () => null;

    const createRatioMetric = (
      displayAsPercentage = false,
    ): FactMetricInterface =>
      ({
        id: "fact__test_ratio",
        metricType: "ratio",
        displayAsPercentage,
        numerator: {
          factTableId: "ft_test",
          column: "value",
          rowFilters: [],
        },
        denominator: {
          factTableId: "ft_test",
          column: "count",
          rowFilters: [],
        },
      }) as unknown as FactMetricInterface;

    it("uses smart compact formatting for large values in ratio metrics", () => {
      const metric = createRatioMetric();
      const formatter = getExperimentMetricFormatter(
        metric,
        mockGetFactTableById,
      );

      const smallValue = formatter(1234);
      expect(smallValue).toBe("1,234");

      const largeValue = formatter(12345);
      expect(largeValue).toMatch(/12\.?3?K/i);

      const veryLargeValue = formatter(1234567);
      expect(veryLargeValue).toMatch(/1\.?2?3?M/i);
    });

    it("does not use compact formatting for values below threshold", () => {
      const metric = createRatioMetric();
      const formatter = getExperimentMetricFormatter(
        metric,
        mockGetFactTableById,
      );

      const result = formatter(9999);
      expect(result).toBe("9,999");
    });

    it("uses percentage format when displayAsPercentage is true", () => {
      const metric = createRatioMetric(true);
      const formatter = getExperimentMetricFormatter(
        metric,
        mockGetFactTableById,
      );

      const result = formatter(0.1234);
      expect(result).toMatch(/12\.?3?%/);
    });

    it("handles negative large values", () => {
      const metric = createRatioMetric();
      const formatter = getExperimentMetricFormatter(
        metric,
        mockGetFactTableById,
      );

      const result = formatter(-50000);
      expect(result).toMatch(/-50K/i);
    });
  });

  describe("getExperimentMetricFormatter for non-ratio fact metrics", () => {
    const mockGetFactTableById = () => null;

    const createProportionMetric = (): FactMetricInterface =>
      ({
        id: "fact__test_proportion",
        metricType: "proportion",
        numerator: {
          factTableId: "ft_test",
          column: "conversions",
          rowFilters: [],
        },
      }) as unknown as FactMetricInterface;

    it("does not use compact formatting for proportion metrics", () => {
      const metric = createProportionMetric();
      const formatter = getExperimentMetricFormatter(
        metric,
        mockGetFactTableById,
      );

      const result = formatter(0.1234);
      expect(result).toMatch(/12\.?3?%/);
    });
  });
});
