import { ExperimentSnapshotInterface } from "shared/types/experiment-snapshot";
import {
  copySnapshotForReport,
  getMetricForSnapshot,
} from "back-end/src/services/reports";
import { factMetricFactory } from "back-end/test/factories/FactMetric.factory";

describe("copySnapshotForReport", () => {
  const snapshot = {
    id: "snp_original",
    experiment: "exp_1",
    type: "standard",
    triggeredBy: "schedule",
    report: "rep_original",
    dimension: "country",
    health: { traffic: { overall: { variationUnits: [10, 12] } } },
  } as unknown as ExperimentSnapshotInterface;

  it("returns a manual report snapshot with a new id and the same results", () => {
    const copy = copySnapshotForReport(snapshot);

    expect(copy.id).toMatch(/^snp_/);
    expect(copy.id).not.toBe("snp_original");
    expect(copy).toMatchObject({
      experiment: "exp_1",
      type: "report",
      triggeredBy: "manual",
      dimension: "country",
    });
  });

  it("fills in a missing traffic dimension map without touching the original", () => {
    const copy = copySnapshotForReport(snapshot);

    expect(copy.health?.traffic.dimension).toEqual({});
    expect(snapshot.health?.traffic.dimension).toBeUndefined();
    expect(snapshot.id).toBe("snp_original");
  });
});

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
