import { PopulationDataInterface } from "shared/types/population-data";
import { PowerCalculationForm } from "@/components/PowerCalculation/PowerCalculationSettingsModal";
import { setMetricDataFromPopulationData } from "@/components/PowerCalculation/power-calculation-utils";

describe("setMetricDataFromPopulationData", () => {
  it("averages users over the lookback window, not the number of week buckets", () => {
    const values: Record<string, unknown> = { metrics: {} };
    const form = {
      watch: (key: string) => values[key],
      setValue: (key: string, value: unknown) => {
        values[key] = value;
      },
    } as unknown as PowerCalculationForm;

    // A 56 day lookback covers 8 weeks but touches 9 week buckets, because the
    // first and last ones are partial.
    const units = [
      { week: "2026-07-13", count: 800 },
      { week: "2026-07-20", count: 900 },
      { week: "2026-07-27", count: 900 },
      { week: "2026-08-03", count: 900 },
      { week: "2026-08-10", count: 900 },
      { week: "2026-08-17", count: 900 },
      { week: "2026-08-24", count: 900 },
      { week: "2026-08-31", count: 900 },
      { week: "2026-09-07", count: 900 },
    ];

    setMetricDataFromPopulationData({
      populationData: {
        status: "success",
        startDate: new Date("2026-07-17T00:00:00Z"),
        endDate: new Date("2026-09-11T00:00:00Z"),
        units,
        metrics: [],
      } as unknown as PopulationDataInterface,
      form,
    });

    // 8000 users over 8 weeks, not over 9 buckets
    expect(values.usersPerWeek).toBe(1000);
  });
});
