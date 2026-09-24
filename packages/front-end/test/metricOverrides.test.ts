import { describe, expect, it } from "vitest";
import {
  describeMetricOverride,
  describeMetricSettings,
  getOverriddenMetricIds,
  MetricSettingsInput,
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
      { key: "window", label: "Conversion window", value: "72 hours" },
      { key: "delay", label: "Metric delay", value: "1 hour" },
      { key: "winRisk", label: "Win risk", value: "0.25%" },
      { key: "loseRisk", label: "Lose risk", value: "1.25%" },
      { key: "cuped", label: "CUPED", value: "On, 14 day lookback" },
      { key: "prior", label: "Prior", value: "Proper (mean 0.1, sd 0.3)" },
    ]);
  });

  it("tells a window switched off from one left alone", () => {
    expect(describeMetricOverride({ id: "met_a", windowType: "" })).toEqual([
      { key: "window", label: "Metric window", value: "None" },
    ]);
    expect(
      describeMetricOverride({ id: "met_a", windowType: "lookback" }),
    ).toEqual([{ key: "window", label: "Lookback window", value: "Default" }]);
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
      { key: "cuped", label: "CUPED", value: "Off" },
      { key: "prior", label: "Prior", value: "Improper" },
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

describe("describeMetricSettings", () => {
  const settings: MetricSettingsInput = {
    windowType: "conversion",
    windowHours: 72,
    delayHours: 0,
    conversionWindowsIgnored: false,
    winRisk: 0.0025,
    loseRisk: 0.0125,
    cuped: { enabled: true, days: 14 },
    prior: { proper: false, mean: 0, stddev: 0.3 },
  };

  it("reads every setting under the Bayesian engine", () => {
    expect(describeMetricSettings(settings, "bayesian", undefined)).toEqual([
      { key: "window", label: "Conversion window", value: "72 hours" },
      { key: "winRisk", label: "Win risk", value: "0.25%" },
      { key: "loseRisk", label: "Lose risk", value: "1.25%" },
      { key: "cuped", label: "CUPED", value: "On, 14 day lookback" },
      { key: "prior", label: "Prior", value: "Improper" },
    ]);
  });

  it("leaves out the Bayesian-only settings under the frequentist engine", () => {
    expect(
      describeMetricSettings(settings, "frequentist", undefined).map(
        (r) => r.key,
      ),
    ).toEqual(["window", "cuped"]);
  });

  it("shows a delay only when there is one, and no window as None", () => {
    expect(
      describeMetricSettings(
        { ...settings, windowType: "", delayHours: 2, cuped: null },
        "frequentist",
        undefined,
      ),
    ).toEqual([
      { key: "window", label: "Metric window", value: "None" },
      { key: "delay", label: "Metric delay", value: "2 hours" },
    ]);
  });

  it("says when the experiment ignores a conversion window, but not a lookback", () => {
    const ignored = { ...settings, conversionWindowsIgnored: true };
    expect(
      describeMetricSettings(ignored, "frequentist", undefined)[0],
    ).toEqual({
      key: "window",
      label: "Conversion window",
      value: "Ignored by this experiment",
    });
    expect(
      describeMetricSettings(
        { ...ignored, windowType: "lookback" },
        "frequentist",
        undefined,
      )[0].value,
    ).toBe("72 hours");
  });

  it("drops each setting the override stands in for, and nothing else", () => {
    expect(
      describeMetricSettings(settings, "bayesian", {
        id: "met_a",
        windowType: "lookback",
        regressionAdjustmentOverride: true,
        regressionAdjustmentEnabled: false,
      }).map((r) => r.key),
    ).toEqual(["winRisk", "loseRisk", "prior"]);
  });
});
