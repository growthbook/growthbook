import { getFunnelStepMetrics } from "shared/experiments";
import type { MetricForSnapshot } from "shared/types/experiment-snapshot";
import type {
  FunnelFactMetricInterface,
  MetricWindowSettings,
} from "shared/types/fact-table";

import {
  getEligibleUsersColumn,
  getUnitEligibilityHours,
  recordUnitEligibility,
} from "back-end/src/integrations/sql/dates/unit-eligibility";
import { factMetricFactory } from "back-end/test/factories/FactMetric.factory";

const settings = {
  skipPartialData: false,
  attributionModel: "firstExposure" as const,
  metricSettings: [] as MetricForSnapshot[],
};

// What a snapshot holds for a metric, before its eligibility is recorded
function snapshotEntry(
  id: string,
  windowSettings: MetricWindowSettings,
): MetricForSnapshot {
  return {
    id,
    computedSettings: {
      windowSettings,
      regressionAdjustmentEnabled: false,
      regressionAdjustmentAvailable: false,
      regressionAdjustmentDays: 0,
      regressionAdjustmentReason: "",
      properPrior: false,
      properPriorMean: 0,
      properPriorStdDev: 1,
    },
  };
}

function buildMetric(
  windowSettings: Partial<MetricWindowSettings> = {},
  overrides: Parameters<typeof factMetricFactory.build>[0] = {},
) {
  return factMetricFactory.build({
    skipPartialData: true,
    ...overrides,
    windowSettings: {
      type: "conversion",
      delayUnit: "hours",
      delayValue: 2,
      windowUnit: "hours",
      windowValue: 3.5,
      ...windowSettings,
    },
  });
}

describe("getUnitEligibilityHours", () => {
  it("is the delay plus the conversion window", () => {
    expect(getUnitEligibilityHours(buildMetric(), settings, null)).toEqual(5.5);
  });

  it("is null unless the metric opts in", () => {
    expect(
      getUnitEligibilityHours(
        buildMetric({}, { skipPartialData: false }),
        settings,
        null,
      ),
    ).toBeNull();
  });

  it("is null when the experiment already excludes in-progress conversions", () => {
    expect(
      getUnitEligibilityHours(
        buildMetric(),
        { ...settings, skipPartialData: true },
        null,
      ),
    ).toBeNull();
  });

  it("is null for a metric with no bound, even with a windowed activation metric", () => {
    expect(
      getUnitEligibilityHours(
        buildMetric({ type: "" }),
        settings,
        buildMetric(),
      ),
    ).toBeNull();
    expect(
      getUnitEligibilityHours(
        buildMetric({ type: "lookback" }),
        settings,
        null,
      ),
    ).toBeNull();
  });

  it("adds the activation metric's window to a bounded metric", () => {
    expect(
      getUnitEligibilityHours(buildMetric(), settings, buildMetric()),
    ).toEqual(11);
  });

  it("is the delay for retention with no end", () => {
    expect(
      getUnitEligibilityHours(
        buildMetric({ type: "" }, { metricType: "retention" }),
        settings,
        null,
      ),
    ).toEqual(2);
  });

  it("is null for quantile metrics", () => {
    expect(
      getUnitEligibilityHours(
        buildMetric(
          {},
          {
            metricType: "quantile",
            quantileSettings: {
              type: "unit",
              quantile: 0.5,
              ignoreZeros: false,
            },
          },
        ),
        settings,
        null,
      ),
    ).toBeNull();
  });

  it("is null for Bandits, including contextual ones and before any weight update", () => {
    const banditSettings = {
      reweight: true,
      decisionMetric: "fact__decision",
      seed: 1,
      currentWeights: [0.5, 0.5],
      historicalWeights: [],
    };
    expect(
      getUnitEligibilityHours(
        buildMetric(),
        { ...settings, banditSettings },
        null,
      ),
    ).toBeNull();
    expect(
      getUnitEligibilityHours(
        buildMetric(),
        {
          ...settings,
          banditSettings: { ...banditSettings, contextualBandit: true },
        },
        null,
      ),
    ).toBeNull();
  });

  it("is null for sub-unit metrics in a cluster experiment, but not cluster-level ones", () => {
    const metric = buildMetric();
    const clusterSettings = {
      ...settings,
      isClusterExperiment: true,
      clusterSubUnitIdentifier: "user_id",
    };
    expect(getUnitEligibilityHours(metric, clusterSettings, null)).toBeNull();
    expect(
      getUnitEligibilityHours(
        metric,
        { ...clusterSettings, clusterLevelMetricIds: [metric.id] },
        null,
      ),
    ).toEqual(5.5);
    // A cluster experiment with no sub-unit analyzes the cluster directly
    expect(
      getUnitEligibilityHours(
        metric,
        { ...settings, isClusterExperiment: true },
        null,
      ),
    ).toEqual(5.5);
  });

  it("follows the experiment's conversion window override", () => {
    // Ignoring conversion windows leaves a plain metric unbounded...
    expect(
      getUnitEligibilityHours(
        buildMetric(),
        { ...settings, attributionModel: "experimentDuration" },
        null,
      ),
    ).toBeNull();
    // ...but retention keeps its delay
    expect(
      getUnitEligibilityHours(
        buildMetric({}, { metricType: "retention" }),
        { ...settings, attributionModel: "experimentDuration" },
        null,
      ),
    ).toEqual(2);
    expect(
      getUnitEligibilityHours(
        buildMetric(),
        { ...settings, attributionModel: "lookbackOverride" },
        null,
      ),
    ).toBeNull();
  });
});

describe("unit eligibility recorded on a snapshot", () => {
  it("is read back over the metric as it is now", () => {
    const metric = buildMetric();
    // Recorded as analyzing every unit; the metric has since opted in
    expect(
      getUnitEligibilityHours(
        metric,
        {
          ...settings,
          metricSettings: [snapshotEntry(metric.id, metric.windowSettings)],
        },
        null,
      ),
    ).toBeNull();

    // Recorded at 5.5 hours; the metric has since opted out with a new window
    const snapshot = {
      ...settings,
      activationMetric: null,
      metricSettings: [snapshotEntry(metric.id, metric.windowSettings)],
    };
    recordUnitEligibility(snapshot, new Map([[metric.id, metric]]));
    expect(
      getUnitEligibilityHours(
        buildMetric(
          { windowValue: 48 },
          { id: metric.id, skipPartialData: false },
        ),
        snapshot,
        null,
      ),
    ).toEqual(5.5);
  });

  it("records hours only for metrics that trim, from the snapshot's windows", () => {
    const trimmed = buildMetric();
    const overridden = buildMetric();
    const untrimmed = buildMetric({}, { skipPartialData: false });
    const activation = buildMetric();
    const record = (activationMetric: string | null) => {
      const snapshot = {
        ...settings,
        activationMetric,
        metricSettings: [
          snapshotEntry(trimmed.id, trimmed.windowSettings),
          snapshotEntry(overridden.id, {
            ...overridden.windowSettings,
            windowValue: 10,
          }),
          snapshotEntry(untrimmed.id, untrimmed.windowSettings),
        ],
      };
      recordUnitEligibility(
        snapshot,
        new Map(
          [trimmed, overridden, untrimmed, activation].map((m) => [m.id, m]),
        ),
      );
      return snapshot.metricSettings.map((s) => s.computedSettings);
    };

    const recorded = record(null);
    expect(recorded.map((s) => s?.unitEligibilityHours)).toEqual([
      5.5,
      12,
      undefined,
    ]);
    // Unset, not null, so the metric's settings hash is unchanged
    expect(recorded[2]).not.toHaveProperty("unitEligibilityHours");
    // The metric documents keep their own windows
    expect(overridden.windowSettings.windowValue).toEqual(3.5);

    expect(record(activation.id).map((s) => s?.unitEligibilityHours)).toEqual([
      11,
      17.5,
      undefined,
    ]);
  });

  it("records a funnel's hours on its steps, which have no step windows of their own", () => {
    const record = (skipPartialData: boolean) => {
      const funnel: FunnelFactMetricInterface = {
        ...buildMetric({ type: "" }, { skipPartialData }),
        metricType: "funnel",
        numerator: null,
        funnelSettings: {
          concurrencyWindowSeconds: 0,
          steps: [60, 30].map((minutes, i) => ({
            name: `Step ${i}`,
            factTableId: "events",
            rowFilters: [],
            optional: false,
            conversionWindow: { value: minutes, unit: "minutes" as const },
          })),
        },
      };
      const metrics = [funnel, ...getFunnelStepMetrics(funnel)];
      const snapshot = {
        ...settings,
        activationMetric: null,
        metricSettings: metrics.map((m) =>
          snapshotEntry(m.id, m.windowSettings),
        ),
      };
      recordUnitEligibility(snapshot, new Map(metrics.map((m) => [m.id, m])));
      return snapshot.metricSettings.map(
        (s) => s.computedSettings?.unitEligibilityHours,
      );
    };

    // The 2 hour delay plus both step windows, on the funnel and each step
    expect(record(true)).toEqual([3.5, 3.5, 3.5]);
    expect(record(false)).toEqual([undefined, undefined, undefined]);
  });
});

describe("getEligibleUsersColumn", () => {
  it("names the column in whole minutes", () => {
    expect(getEligibleUsersColumn(5.5)).toEqual("users_cw330m");
  });
});
