import { ExperimentSnapshotSettings } from "shared/types/experiment-snapshot";
import { getExperimentEndDate } from "back-end/src/integrations/sql/dates/experiment-end-date";

describe("getExperimentEndDate", () => {
  const baseSettings: ExperimentSnapshotSettings = {
    manual: false,
    dimensions: [],
    metricSettings: [],
    goalMetrics: [],
    secondaryMetrics: [],
    guardrailMetrics: [],
    activationMetric: null,
    defaultMetricPriorSettings: {
      override: false,
      proper: false,
      mean: 0,
      stddev: 0,
    },
    regressionAdjustmentEnabled: false,
    attributionModel: "firstExposure",
    experimentId: "exp_1",
    queryFilter: "",
    segment: "",
    skipPartialData: false,
    datasourceId: "ds_1",
    exposureQueryId: "exposure",
    startDate: new Date("2024-01-01T00:00:00Z"),
    endDate: new Date("2024-01-31T00:00:00Z"),
    variations: [],
  };

  const settingsWith = (
    skipPartialData: boolean,
    endDate: Date,
  ): ExperimentSnapshotSettings => ({
    ...baseSettings,
    skipPartialData,
    endDate,
  });

  it("returns the phase end date (ignoring now) when skipPartialData is false", () => {
    const endDate = new Date("2024-01-31T00:00:00Z");
    const now = new Date("2024-06-01T00:00:00Z");
    expect(getExperimentEndDate(settingsWith(false, endDate), 1000, now)).toBe(
      endDate,
    );
  });

  it("returns the phase end date when the conversion-window cutoff is later than it", () => {
    // now is months after endDate, so now - 1h is still well past endDate and
    // min() keeps the phase end date.
    const endDate = new Date("2024-01-31T00:00:00Z");
    const now = new Date("2024-06-01T00:00:00Z");
    expect(getExperimentEndDate(settingsWith(true, endDate), 1, now)).toEqual(
      endDate,
    );
  });

  it("honors the explicit reference time instead of the wall clock", () => {
    // Far-future end date + 0-hour window => cutoff is exactly `now`. If the
    // function used the real wall clock instead of the passed-in time, the
    // result would be today's date, not the pinned 2024-01-10.
    const farEndDate = new Date("2025-01-01T00:00:00Z");
    const now = new Date("2024-01-10T00:00:00Z");
    expect(
      getExperimentEndDate(settingsWith(true, farEndDate), 0, now),
    ).toEqual(now);
  });

  it("pulls the cutoff earlier as the conversion window grows", () => {
    const farEndDate = new Date("2025-01-01T00:00:00Z");
    const now = new Date("2024-06-15T00:00:00Z");
    const noWindow = getExperimentEndDate(
      settingsWith(true, farEndDate),
      0,
      now,
    );
    const dayWindow = getExperimentEndDate(
      settingsWith(true, farEndDate),
      48,
      now,
    );
    // 0-hour window => cutoff is exactly now; a 48h window must be strictly
    // earlier (and never reaches the far-future end date).
    expect(noWindow).toEqual(now);
    expect(dayWindow.getTime()).toBeLessThan(now.getTime());
  });
});
