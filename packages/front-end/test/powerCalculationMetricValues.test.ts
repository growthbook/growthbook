import { PopulationDataInterface } from "shared/types/population-data";
import { PowerCalculationForm } from "@/components/PowerCalculation/PowerCalculationSettingsModal";
import { setMetricDataFromPopulationData } from "@/components/PowerCalculation/power-calculation-utils";

type StoredMetric = { mean: number; standardDeviation: number };

function formWithMetrics(metrics: Record<string, unknown>) {
  const values: Record<string, unknown> = { metrics };
  const form = {
    watch: (key: string) => values[key],
    setValue: (key: string, value: unknown) => {
      values[key] = value;
    },
  } as unknown as PowerCalculationForm;
  return { form, values };
}

function populationData(metrics: unknown[]) {
  return {
    status: "success",
    startDate: new Date("2026-07-17T00:00:00Z"),
    endDate: new Date("2026-09-11T00:00:00Z"),
    units: [{ week: "2026-07-13", count: 8000 }],
    metrics,
  } as unknown as PopulationDataInterface;
}

describe("setMetricDataFromPopulationData", () => {
  it("stores a standard deviation for mean metrics", () => {
    const { form, values } = formWithMetrics({
      mean_metric: { type: "mean", mean: 0, standardDeviation: 0 },
    });

    setMetricDataFromPopulationData({
      populationData: populationData([
        {
          metricId: "mean_metric",
          type: "mean",
          data: { main_sum: 10, main_sum_squares: 30, count: 4 },
        },
      ]),
      form,
    });

    const metric = (values.metrics as Record<string, StoredMetric>).mean_metric;

    // variance = (30 - 10^2 / 4) / 3 = 5 / 3
    expect(metric.mean).toBeCloseTo(2.5, 10);
    expect(metric.standardDeviation).toBeCloseTo(Math.sqrt(5 / 3), 10);
  });

  it("stores a standard deviation for ratio metrics", () => {
    const { form, values } = formWithMetrics({
      ratio_metric: { type: "mean", mean: 0, standardDeviation: 0 },
    });

    setMetricDataFromPopulationData({
      populationData: populationData([
        {
          metricId: "ratio_metric",
          type: "ratio",
          data: {
            main_sum: 4,
            main_sum_squares: 10,
            denominator_sum: 4,
            denominator_sum_squares: 8,
            main_denominator_sum_product: 8,
            count: 2,
          },
        },
      ]),
      form,
    });

    const metric = (values.metrics as Record<string, StoredMetric>)
      .ratio_metric;

    // numerator variance 2, denominator variance 0, covariance 0, both means 2,
    // so the delta method variance is 2 / 2^2 = 0.5
    expect(metric.mean).toBeCloseTo(1, 10);
    expect(metric.standardDeviation).toBeCloseTo(Math.sqrt(0.5), 10);
  });
});
