import type { ExperimentMetricInterface } from "shared/experiments";
import { getMetricEnd } from "back-end/src/integrations/sql/dates/metric-end";

const END_DATE = new Date("2026-10-20T00:00:00.000Z");

const threeDayConversionMetric = {
  windowSettings: {
    type: "conversion",
    windowValue: 72,
    windowUnit: "hours",
    delayValue: 0,
    delayUnit: "hours",
  },
} as unknown as ExperimentMetricInterface;

describe("getMetricEnd", () => {
  it("extends past the end date by the conversion window", () => {
    expect(getMetricEnd([threeDayConversionMetric], END_DATE)).toEqual(
      new Date("2026-10-23T00:00:00.000Z"),
    );
  });

  it("stops at a cutoff date", () => {
    expect(
      getMetricEnd([threeDayConversionMetric], END_DATE, false, END_DATE),
    ).toEqual(END_DATE);
  });

  it("keeps the conversion window when it ends before the cutoff date", () => {
    const cutoffDate = new Date("2026-10-25T00:00:00.000Z");
    expect(
      getMetricEnd([threeDayConversionMetric], END_DATE, false, cutoffDate),
    ).toEqual(new Date("2026-10-23T00:00:00.000Z"));
  });

  it("stops at the end date when conversion windows are overridden", () => {
    expect(getMetricEnd([threeDayConversionMetric], END_DATE, true)).toEqual(
      END_DATE,
    );
  });
});
