import { getMetricForSnapshot } from "back-end/src/services/reports";
import { factMetricFactory } from "back-end/test/factories/FactMetric.factory";

const metric = factMetricFactory.build({
  id: "fact_window",
  windowSettings: {
    type: "conversion",
    delayValue: 2,
    delayUnit: "days",
    windowValue: 3,
    windowUnit: "days",
  },
});

function windowSettingsWith(
  override: Parameters<typeof getMetricForSnapshot>[0]["metricOverrides"],
) {
  return getMetricForSnapshot({
    id: metric.id,
    metricMap: new Map([[metric.id, metric]]),
    metricOverrides: override,
    decisionFrameworkSettings: {},
  })?.computedSettings.windowSettings;
}

describe("getMetricForSnapshot window overrides", () => {
  it("keeps the metric's window and unit when only the window type is overridden", () => {
    expect(
      windowSettingsWith([{ id: metric.id, windowType: "conversion" }]),
    ).toMatchObject({ type: "conversion", windowValue: 3, windowUnit: "days" });
  });

  it("keeps the metric's window and unit when only the delay is overridden", () => {
    expect(
      windowSettingsWith([
        { id: metric.id, windowType: "conversion", delayHours: 1 },
      ]),
    ).toMatchObject({
      delayValue: 1,
      delayUnit: "hours",
      windowValue: 3,
      windowUnit: "days",
    });
  });

  it("uses hours for an overridden delay of zero", () => {
    expect(
      windowSettingsWith([
        { id: metric.id, windowType: "conversion", delayHours: 0 },
      ]),
    ).toMatchObject({ delayValue: 0, delayUnit: "hours" });
  });

  it("uses hours for an overridden window length", () => {
    expect(
      windowSettingsWith([
        { id: metric.id, windowType: "conversion", windowHours: 12 },
      ]),
    ).toMatchObject({ windowValue: 12, windowUnit: "hours" });
  });

  it("switches to the overridden window type with the metric's window", () => {
    expect(
      windowSettingsWith([{ id: metric.id, windowType: "lookback" }]),
    ).toMatchObject({ type: "lookback", windowValue: 3, windowUnit: "days" });
  });
});
