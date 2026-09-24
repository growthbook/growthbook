import { describe, expect, it } from "vitest";
import {
  describeMetricOverride,
  getOverriddenMetricIds,
} from "@/services/metricOverrides";

describe("describeMetricOverride", () => {
  it("lists nothing for an entry that overrides nothing", () => {
    expect(describeMetricOverride({ id: "met_a" })).toEqual([]);
  });

  it("reads each overridden field in the editor's units", () => {
    expect(
      describeMetricOverride({
        id: "met_a",
        windowType: "conversion",
        windowHours: 72,
        delayHours: 1,
        winRisk: 0.0025,
        loseRisk: 0.0125,
        regressionAdjustmentOverride: true,
        regressionAdjustmentEnabled: true,
        regressionAdjustmentDays: 14,
        properPriorOverride: true,
        properPriorEnabled: true,
        properPriorMean: 0.1,
        properPriorStdDev: 0.3,
      }),
    ).toEqual([
      { label: "Conversion window", value: "72 hours" },
      { label: "Metric delay", value: "1 hour" },
      { label: "Win risk", value: "0.25%" },
      { label: "Lose risk", value: "1.25%" },
      { label: "CUPED", value: "On, 14 day lookback" },
      { label: "Prior", value: "Proper (mean 0.1, sd 0.3)" },
    ]);
  });

  it("tells a window switched off from one left alone", () => {
    expect(describeMetricOverride({ id: "met_a", windowType: "" })).toEqual([
      { label: "Metric window", value: "None" },
    ]);
    expect(
      describeMetricOverride({ id: "met_a", windowType: "lookback" }),
    ).toEqual([{ label: "Lookback window", value: "Default" }]);
  });

  it("reads a switched-off override as off, not as unset", () => {
    expect(
      describeMetricOverride({
        id: "met_a",
        regressionAdjustmentOverride: true,
        regressionAdjustmentEnabled: false,
        properPriorOverride: true,
        properPriorEnabled: false,
      }),
    ).toEqual([
      { label: "CUPED", value: "Off" },
      { label: "Prior", value: "Improper" },
    ]);
  });

  it("ignores override values whose override flag is off", () => {
    expect(
      describeMetricOverride({
        id: "met_a",
        regressionAdjustmentOverride: false,
        regressionAdjustmentEnabled: true,
        properPriorOverride: false,
        properPriorEnabled: true,
      }),
    ).toEqual([]);
  });
});

describe("getOverriddenMetricIds", () => {
  it("keeps only metrics with something overridden", () => {
    expect(
      getOverriddenMetricIds([
        { id: "met_a", delayHours: 2 },
        { id: "met_b" },
        { id: "met_c", regressionAdjustmentOverride: false },
      ]),
    ).toEqual(new Set(["met_a"]));
  });

  it("is empty without overrides", () => {
    expect(getOverriddenMetricIds(undefined)).toEqual(new Set());
  });
});
