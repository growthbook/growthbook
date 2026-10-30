import { describe, expect, it } from "vitest";
import { experimentAnalysisSettingsDraft } from "shared/validators";
import {
  describeMetricOverride,
  describeMetricSettings,
  getOverriddenMetricIds,
  getOverridesBlockedReason,
  mergeTargetMDEs,
  MetricSettingsInput,
  pruneMetricOverrides,
  withoutDeprecatedOverrideFields,
} from "@/services/metricOverrides";

describe("describeMetricOverride", () => {
  it("reads each overridden field in the editor's units", () => {
    expect(
      describeMetricOverride({
        id: "met_a",
        windowType: "conversion",
        windowHours: 72,
        delayHours: 1,
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

  it("reads a goal metric's target MDE first", () => {
    expect(
      describeMetricOverride({ id: "met_a", delayHours: 2 }, 0.05).map((r) => [
        r.key,
        r.value,
      ]),
    ).toEqual([
      ["targetMDE", "5%"],
      ["delay", "2 hours"],
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

  it("reads window hours overridden without a window type", () => {
    expect(describeMetricOverride({ id: "met_a", windowHours: 12 })).toEqual([
      { key: "window", label: "Metric window", value: "12 hours" },
    ]);
  });

  it("says when the experiment doesn't apply an override", () => {
    const override = {
      id: "met_a",
      windowType: "conversion" as const,
      windowHours: 12,
      regressionAdjustmentOverride: true,
      regressionAdjustmentEnabled: true,
      regressionAdjustmentDays: 7,
    };
    expect(
      describeMetricOverride(override, undefined, {
        conversionWindowsIgnored: true,
        cupedOff: true,
      }).map((r) => r.value),
    ).toEqual(["Ignored by this experiment", "Ignored by this experiment"]);
    expect(
      describeMetricOverride(
        { id: "met_a", windowType: "lookback", windowHours: 12 },
        undefined,
        { conversionWindowsIgnored: true, cupedOff: true },
      ).map((r) => r.value),
    ).toEqual(["12 hours"]);
  });

  it("reads hours alone as the metric's own kind of window", () => {
    const override = { id: "met_a", windowHours: 12 };
    const context = { conversionWindowsIgnored: true, cupedOff: false };
    expect(
      describeMetricOverride(override, undefined, {
        ...context,
        metricWindowType: "conversion",
      }),
    ).toEqual([
      {
        key: "window",
        label: "Conversion window",
        value: "Ignored by this experiment",
      },
    ]);
    expect(
      describeMetricOverride(override, undefined, {
        ...context,
        metricWindowType: "lookback",
      }),
    ).toEqual([{ key: "window", label: "Lookback window", value: "12 hours" }]);
  });
});

describe("pruneMetricOverrides", () => {
  it("keeps only what changes the analysis, dropping metrics left with nothing", () => {
    expect(
      pruneMetricOverrides([
        {
          id: "met_a",
          delayHours: 2,
          regressionAdjustmentOverride: false,
          regressionAdjustmentDays: 14,
          properPriorOverride: false,
          properPriorEnabled: false,
          properPriorMean: 0,
          properPriorStdDev: 0.3,
        },
        { id: "met_b", regressionAdjustmentDays: 14, properPriorMean: 0 },
        { id: "met_c", windowHours: 12 },
        { id: "met_d", windowType: "" },
        {
          id: "met_e",
          regressionAdjustmentOverride: true,
          regressionAdjustmentEnabled: false,
          properPriorOverride: true,
          properPriorEnabled: true,
          properPriorMean: 0.1,
        },
      ]),
    ).toEqual([
      { id: "met_a", delayHours: 2 },
      { id: "met_c", windowHours: 12 },
      { id: "met_d", windowType: "" },
      {
        id: "met_e",
        regressionAdjustmentOverride: true,
        regressionAdjustmentEnabled: false,
        properPriorOverride: true,
        properPriorEnabled: true,
        properPriorMean: 0.1,
      },
    ]);
  });
});

describe("mergeTargetMDEs", () => {
  const previous = [
    { id: "met_old", targetMDE: 0.03 },
    { id: "met_a", targetMDE: 0.07 },
    { id: "met_b", targetMDE: 0.01 },
  ];

  it("keeps every target MDE as it was when none changed", () => {
    const merged = mergeTargetMDEs(previous, ["met_b", "met_a"], {
      met_a: 7,
      met_b: 1,
    });
    expect(merged).toEqual(previous);
    expect(merged[1]).toBe(previous[1]);
  });

  it("changes, clears and adds goals' target MDEs in place", () => {
    expect(
      mergeTargetMDEs(previous, ["met_a", "met_b", "met_c"], {
        met_a: 5,
        met_b: undefined,
        met_c: 2,
      }),
    ).toEqual([
      { id: "met_old", targetMDE: 0.03 },
      { id: "met_a", targetMDE: 0.05 },
      { id: "met_c", targetMDE: 0.02 },
    ]);
  });

  it("treats an emptied field as cleared", () => {
    expect(mergeTargetMDEs(previous, ["met_a"], { met_a: NaN })).toEqual([
      { id: "met_old", targetMDE: 0.03 },
      { id: "met_b", targetMDE: 0.01 },
    ]);
  });
});

describe("getOverriddenMetricIds", () => {
  it("keeps only metrics with something overridden, a target MDE alone included", () => {
    expect(
      getOverriddenMetricIds(
        [
          { id: "met_a", delayHours: 2 },
          { id: "met_b" },
          { id: "met_c", regressionAdjustmentOverride: false },
        ],
        [{ id: "met_d", targetMDE: 0.05 }, { id: "met_e" }],
      ),
    ).toEqual(new Set(["met_a", "met_d"]));
    expect(getOverriddenMetricIds(undefined)).toEqual(new Set());
  });
});

describe("describeMetricSettings", () => {
  const settings: MetricSettingsInput = {
    windowType: "conversion",
    windowHours: 72,
    delayHours: 0,
    conversionWindowsIgnored: false,
    cuped: { enabled: true, days: 14 },
    prior: { proper: false, mean: 0, stddev: 0.3 },
  };

  it("reads every setting under the Bayesian engine", () => {
    expect(describeMetricSettings(settings, "bayesian", undefined)).toEqual([
      { key: "window", label: "Conversion window", value: "72 hours" },
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

  it("leads with a goal metric's target MDE, until it's overridden", () => {
    const goal = { ...settings, targetMDE: 0.1 };
    expect(describeMetricSettings(goal, "frequentist", undefined)[0]).toEqual({
      key: "targetMDE",
      label: "Target MDE",
      value: "10%",
    });
    expect(
      describeMetricSettings(goal, "frequentist", undefined, 0.05).map(
        (r) => r.key,
      ),
    ).toEqual(["window", "cuped"]);
  });

  it("drops each setting the override stands in for, and nothing else", () => {
    expect(
      describeMetricSettings(settings, "bayesian", {
        id: "met_a",
        windowType: "lookback",
        regressionAdjustmentOverride: true,
        regressionAdjustmentEnabled: false,
      }).map((r) => r.key),
    ).toEqual(["prior"]);
  });
});

describe("withoutDeprecatedOverrideFields", () => {
  it("lets a legacy override through the draft schema, keeping its settings", () => {
    const legacy = {
      id: "met_a",
      windowType: "conversion" as const,
      windowHours: 72,
      delayHours: 1,
      conversionWindowHours: 72,
      conversionDelayHours: 1,
      winRisk: 0.0025,
      loseRisk: 0.0125,
    };
    expect(() =>
      experimentAnalysisSettingsDraft.parse({ metricOverrides: [legacy] }),
    ).toThrow();

    expect(
      experimentAnalysisSettingsDraft.parse({
        metricOverrides: withoutDeprecatedOverrideFields([legacy]),
      }).metricOverrides,
    ).toEqual([
      { id: "met_a", windowType: "conversion", windowHours: 72, delayHours: 1 },
    ]);
    expect(legacy.conversionWindowHours).toBe(72);
  });
});

describe("getOverridesBlockedReason", () => {
  const paid = "Overriding metrics is available on paid plans.";
  const goalsOnly =
    "Experiments using incremental refresh can only override goal metrics' target MDEs.";
  const none =
    "Metric overrides aren't available for experiments using incremental refresh.";
  const reason = (
    hasFeature: boolean,
    incremental: boolean,
    targetMDEsEditable: boolean,
    goal: boolean,
  ) =>
    getOverridesBlockedReason({
      hasFeature,
      incremental,
      targetMDEsEditable,
      goal,
    });

  it("opens for every metric with the feature and no incremental refresh", () => {
    expect(reason(true, false, false, false)).toBeNull();
    expect(reason(true, false, true, true)).toBeNull();
  });

  it("keeps goals' target MDEs open under incremental refresh", () => {
    expect(reason(true, true, true, true)).toBeNull();
    expect(reason(true, true, true, false)).toBe(goalsOnly);
  });

  it("locks everything under incremental refresh without target MDEs", () => {
    expect(reason(true, true, false, true)).toBe(none);
    expect(reason(true, true, false, false)).toBe(none);
  });

  it("keeps goals' target MDEs open without the feature", () => {
    expect(reason(false, false, true, true)).toBeNull();
    expect(reason(false, true, true, true)).toBeNull();
    expect(reason(false, false, true, false)).toBe(paid);
    expect(reason(false, true, false, true)).toBe(paid);
  });
});
