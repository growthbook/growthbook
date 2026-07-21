import { ExperimentSnapshotAnalysisSettings } from "shared/types/experiment-snapshot";
import { DataSourceInterface } from "shared/types/datasource";
import { SafeRolloutInterface } from "shared/types/safe-rollout";
import { getSafeRolloutSnapshotSettings } from "back-end/src/services/safeRolloutSnapshots";

// Helper to construct a minimal SafeRollout suitable for snapshot-settings
// generation. The function under test only reads a small slice of the
// SafeRollout shape, so we deliberately cast through `unknown` rather than
// fabricate every persisted field.
function makeSafeRollout(
  overrides: Partial<SafeRolloutInterface> = {},
): SafeRolloutInterface {
  return {
    id: "sr_1",
    organization: "org_1",
    dateCreated: new Date("2026-01-01T00:00:00Z"),
    dateUpdated: new Date("2026-01-01T00:00:00Z"),
    featureId: "feat_1",
    datasourceId: "ds_1",
    exposureQueryId: "exposure_1",
    guardrailMetricIds: [],
    autoRollback: true,
    autoSnapshots: true,
    status: "running",
    maxDuration: { amount: 7, unit: "days" },
    rampUpSchedule: {
      enabled: false,
      step: 0,
      steps: [],
      rampUpCompleted: false,
    },
    startedAt: new Date("2026-01-02T00:00:00Z"),
    ...overrides,
  } as SafeRolloutInterface;
}

const defaultAnalysisSettings: ExperimentSnapshotAnalysisSettings = {
  statsEngine: "frequentist",
  dimensions: [],
  regressionAdjusted: false,
  baselineVariationIndex: 0,
  differenceType: "absolute",
  pValueThreshold: 0.05,
  numGoalMetrics: 0,
  numGuardrailMetrics: 0,
  sequentialTesting: false,
  sequentialTestingTuningParameter: 0.05,
  postStratificationEnabled: false,
};

const datasource = {
  id: "ds_1",
  settings: { queries: { exposure: [] } },
} as DataSourceInterface;

describe("getSafeRolloutSnapshotSettings — variation arm mapping", () => {
  it("v1 safe rollout: variation_id '0' is baseline, '1' is treatment", () => {
    // v1 safe rollouts have no linked rampScheduleId. The SDK emits
    // variation_id '0' for users assigned controlValue and '1' for users
    // assigned variationValue, so the snapshot keeps the natural order.
    const settings = getSafeRolloutSnapshotSettings({
      safeRollout: makeSafeRollout({ rampScheduleId: undefined }),
      trackingKey: "feat_1",
      settings: defaultAnalysisSettings,
      orgPriorSettings: undefined,
      settingsForSnapshotMetrics: [],
      metricMap: new Map(),
      factTableMap: new Map(),
      metricGroups: [],
      datasource,
    });

    expect(settings.variations).toEqual([
      { id: "0", weight: 0.5 },
      { id: "1", weight: 0.5 },
    ]);
  });

  it("v2 monitored ramp: variation_id '1' (passthrough) is baseline, '0' (rollout value) is treatment", () => {
    // v2 monitored rollout rules emit variation_id '0' for users who receive
    // the new rollout value and '1' for users in the passthrough/control arm.
    // The downstream analysis pipeline treats `variations[0]` as the baseline
    // arm everywhere (computeResultsStatus, /status endpoint, results UI),
    // so we place id '1' first to keep positional indexing aligned with
    // semantic roles. Without this swap, guardrail directionality would be
    // inverted for monitored ramps.
    const settings = getSafeRolloutSnapshotSettings({
      safeRollout: makeSafeRollout({ rampScheduleId: "rs_1" }),
      trackingKey: "feat_1",
      settings: defaultAnalysisSettings,
      orgPriorSettings: undefined,
      settingsForSnapshotMetrics: [],
      metricMap: new Map(),
      factTableMap: new Map(),
      metricGroups: [],
      datasource,
    });

    expect(settings.variations).toEqual([
      { id: "1", weight: 0.5 },
      { id: "0", weight: 0.5 },
    ]);
  });

  it("uses the provided tracking key as the experimentId regardless of mode", () => {
    const v1 = getSafeRolloutSnapshotSettings({
      safeRollout: makeSafeRollout(),
      trackingKey: "my-tracking-key",
      settings: defaultAnalysisSettings,
      orgPriorSettings: undefined,
      settingsForSnapshotMetrics: [],
      metricMap: new Map(),
      factTableMap: new Map(),
      metricGroups: [],
      datasource,
    });
    const v2 = getSafeRolloutSnapshotSettings({
      safeRollout: makeSafeRollout({ rampScheduleId: "rs_1" }),
      trackingKey: "ramp_rs_1",
      settings: defaultAnalysisSettings,
      orgPriorSettings: undefined,
      settingsForSnapshotMetrics: [],
      metricMap: new Map(),
      factTableMap: new Map(),
      metricGroups: [],
      datasource,
    });

    expect(v1.experimentId).toBe("my-tracking-key");
    expect(v2.experimentId).toBe("ramp_rs_1");
  });
});
