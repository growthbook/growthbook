import { OrganizationInterface } from "shared/types/organization";
import { ExperimentInterface } from "shared/types/experiment";
import { ExperimentSnapshotSettings } from "shared/types/experiment-snapshot";
import { IncrementalRefreshInterface } from "shared/validators";
import { ExperimentMetricInterface, isFactMetric } from "shared/experiments";
import {
  checkIncrementalRefreshEligibility,
  getExperimentSettingsHashForIncrementalRefresh,
} from "back-end/src/enterprise/services/data-pipeline";
import { orgHasPremiumFeature } from "back-end/src/enterprise";
import { SourceIntegrationInterface } from "back-end/src/types/Integration";

jest.mock("back-end/src/enterprise", () => ({
  orgHasPremiumFeature: jest.fn(),
}));

const orgHasPremiumFeatureMock = orgHasPremiumFeature as jest.MockedFunction<
  typeof orgHasPremiumFeature
>;

function makeOrg(): OrganizationInterface {
  return { id: "org_1" } as unknown as OrganizationInterface;
}

function makeIntegration(
  overrides: Partial<{
    hasIncrementalRefresh: boolean;
    hasQuantileSketch: boolean;
    pipelineEnabled: boolean;
  }> = {},
): SourceIntegrationInterface {
  const {
    hasIncrementalRefresh = true,
    hasQuantileSketch = true,
    pipelineEnabled = true,
  } = overrides;
  return {
    datasource: {
      settings: {
        pipelineSettings: pipelineEnabled
          ? { allowWriting: true, mode: "incremental" }
          : {},
      },
    },
    getSourceProperties: () => ({
      hasIncrementalRefresh,
      hasQuantileSketch,
    }),
  } as unknown as SourceIntegrationInterface;
}

function makeExperiment(
  overrides: Partial<ExperimentInterface> = {},
): ExperimentInterface {
  return {
    id: "exp_1",
    activationMetric: null,
    type: "standard",
    ...overrides,
  } as unknown as ExperimentInterface;
}

function makeSnapshotSettings(
  overrides: Partial<ExperimentSnapshotSettings> = {},
): ExperimentSnapshotSettings {
  return {
    skipPartialData: false,
    metricSettings: [{ id: "m1" }],
    dimensions: [],
    datasourceId: "ds_1",
    experimentId: "exp_1",
    activationMetric: null,
    attributionModel: "firstExposure",
    queryFilter: "",
    segment: "",
    startDate: new Date("2024-01-01"),
    regressionAdjustmentEnabled: false,
    exposureQueryId: "eq_1",
    ...overrides,
  } as unknown as ExperimentSnapshotSettings;
}

function makeFactMetric(quantileType?: "event" | "unit") {
  return {
    id: "m1",
    metricType: quantileType === "event" ? "quantile" : "mean",
    numerator: { factTableId: "ft_1", column: "amount" },
    quantileSettings: quantileType
      ? { type: quantileType, quantile: 0.9, ignoreZeros: false }
      : undefined,
  } as unknown as ExperimentMetricInterface;
}

function makeMetricMap(
  metric: ExperimentMetricInterface = makeFactMetric(),
): Map<string, ExperimentMetricInterface> {
  return new Map([["m1", metric]]);
}

describe("checkIncrementalRefreshEligibility", () => {
  beforeEach(() => {
    orgHasPremiumFeatureMock.mockReturnValue(true);
  });

  it("returns eligible when all conditions pass", async () => {
    const result = await checkIncrementalRefreshEligibility({
      org: makeOrg(),
      integration: makeIntegration(),
      snapshotSettings: makeSnapshotSettings(),
      metricMap: makeMetricMap(),
      experiment: makeExperiment(),
      incrementalRefreshModel: null,
      analysisType: "main-update",
    });
    expect(result.eligible).toBe(true);
  });

  it("returns skip-partial-data when skipPartialData is true", async () => {
    const result = await checkIncrementalRefreshEligibility({
      org: makeOrg(),
      integration: makeIntegration(),
      snapshotSettings: makeSnapshotSettings({ skipPartialData: true }),
      metricMap: makeMetricMap(),
      experiment: makeExperiment(),
      incrementalRefreshModel: null,
      analysisType: "main-update",
    });
    expect(result.eligible).toBe(false);
    if (!result.eligible) {
      expect(result.fallback.code).toBe("skip-partial-data");
    }
  });

  it("returns datasource-unsupported when integration lacks hasIncrementalRefresh", async () => {
    const result = await checkIncrementalRefreshEligibility({
      org: makeOrg(),
      integration: makeIntegration({ hasIncrementalRefresh: false }),
      snapshotSettings: makeSnapshotSettings(),
      metricMap: makeMetricMap(),
      experiment: makeExperiment(),
      incrementalRefreshModel: null,
      analysisType: "main-update",
    });
    expect(result.eligible).toBe(false);
    if (!result.eligible) {
      expect(result.fallback.code).toBe("datasource-unsupported");
    }
  });

  it("returns missing-premium-feature when org lacks incremental-refresh feature", async () => {
    orgHasPremiumFeatureMock.mockReturnValue(false);
    const result = await checkIncrementalRefreshEligibility({
      org: makeOrg(),
      integration: makeIntegration(),
      snapshotSettings: makeSnapshotSettings(),
      metricMap: makeMetricMap(),
      experiment: makeExperiment(),
      incrementalRefreshModel: null,
      analysisType: "main-update",
    });
    expect(result.eligible).toBe(false);
    if (!result.eligible) {
      expect(result.fallback.code).toBe("missing-premium-feature");
    }
  });

  it("returns not-enabled when pipeline is not enabled for the experiment", async () => {
    const result = await checkIncrementalRefreshEligibility({
      org: makeOrg(),
      integration: makeIntegration({ pipelineEnabled: false }),
      snapshotSettings: makeSnapshotSettings(),
      metricMap: makeMetricMap(),
      experiment: makeExperiment(),
      incrementalRefreshModel: null,
      analysisType: "main-update",
    });
    expect(result.eligible).toBe(false);
    if (!result.eligible) {
      expect(result.fallback.code).toBe("not-enabled");
    }
  });

  it("returns activation-metric when experiment has an activation metric", async () => {
    const result = await checkIncrementalRefreshEligibility({
      org: makeOrg(),
      integration: makeIntegration(),
      snapshotSettings: makeSnapshotSettings(),
      metricMap: makeMetricMap(),
      experiment: makeExperiment({ activationMetric: "met_act" as never }),
      incrementalRefreshModel: null,
      analysisType: "main-update",
    });
    expect(result.eligible).toBe(false);
    if (!result.eligible) {
      expect(result.fallback.code).toBe("activation-metric");
    }
  });

  it("returns no-metrics-selected when no metrics resolve in the metric map", async () => {
    const result = await checkIncrementalRefreshEligibility({
      org: makeOrg(),
      integration: makeIntegration(),
      snapshotSettings: makeSnapshotSettings(),
      metricMap: new Map(), // m1 not in map
      experiment: makeExperiment(),
      incrementalRefreshModel: null,
      analysisType: "main-update",
    });
    expect(result.eligible).toBe(false);
    if (!result.eligible) {
      expect(result.fallback.code).toBe("no-metrics-selected");
    }
  });

  it("returns non-fact-metrics when a non-fact metric is selected", async () => {
    // Legacy metrics do not have a metricType field — isFactMetric checks for "metricType" in m
    const legacyMetric = {
      id: "m1",
      type: "mean",
    } as unknown as ExperimentMetricInterface;
    expect(isFactMetric(legacyMetric)).toBe(false);

    const result = await checkIncrementalRefreshEligibility({
      org: makeOrg(),
      integration: makeIntegration(),
      snapshotSettings: makeSnapshotSettings(),
      metricMap: new Map([["m1", legacyMetric]]),
      experiment: makeExperiment(),
      incrementalRefreshModel: null,
      analysisType: "main-update",
    });
    expect(result.eligible).toBe(false);
    if (!result.eligible) {
      expect(result.fallback.code).toBe("non-fact-metrics");
    }
  });

  it("returns event-quantile-metric when an event quantile metric is used on a datasource without sketch support", async () => {
    const result = await checkIncrementalRefreshEligibility({
      org: makeOrg(),
      integration: makeIntegration({ hasQuantileSketch: false }),
      snapshotSettings: makeSnapshotSettings(),
      metricMap: makeMetricMap(makeFactMetric("event")),
      experiment: makeExperiment(),
      incrementalRefreshModel: null,
      analysisType: "main-update",
    });
    expect(result.eligible).toBe(false);
    if (!result.eligible) {
      expect(result.fallback.code).toBe("event-quantile-metric");
    }
  });

  it("returns settings-outdated when analysisType is main-update and settings hash has changed", async () => {
    const snapshotSettings = makeSnapshotSettings();
    const storedHash =
      getExperimentSettingsHashForIncrementalRefresh(snapshotSettings);
    const staleModel = {
      experimentSettingsHash: storedHash + "_stale",
      unitsTableFullName: "db.schema.units",
    } as unknown as IncrementalRefreshInterface;

    const result = await checkIncrementalRefreshEligibility({
      org: makeOrg(),
      integration: makeIntegration(),
      snapshotSettings,
      metricMap: makeMetricMap(),
      experiment: makeExperiment(),
      incrementalRefreshModel: staleModel,
      analysisType: "main-update",
    });
    expect(result.eligible).toBe(false);
    if (!result.eligible) {
      expect(result.fallback.code).toBe("settings-outdated");
    }
  });

  it("returns eligible when analysisType is main-fullRefresh even when settings hash has changed", async () => {
    const snapshotSettings = makeSnapshotSettings();
    const staleModel = {
      experimentSettingsHash: "stale_hash",
      unitsTableFullName: "db.schema.units",
    } as unknown as IncrementalRefreshInterface;

    const result = await checkIncrementalRefreshEligibility({
      org: makeOrg(),
      integration: makeIntegration(),
      snapshotSettings,
      metricMap: makeMetricMap(),
      experiment: makeExperiment(),
      incrementalRefreshModel: staleModel,
      analysisType: "main-fullRefresh",
    });
    expect(result.eligible).toBe(true);
  });

  it("message is verbatim for skip-partial-data", async () => {
    const result = await checkIncrementalRefreshEligibility({
      org: makeOrg(),
      integration: makeIntegration(),
      snapshotSettings: makeSnapshotSettings({ skipPartialData: true }),
      metricMap: makeMetricMap(),
      experiment: makeExperiment(),
      incrementalRefreshModel: null,
      analysisType: "main-update",
    });
    expect(result.eligible).toBe(false);
    if (!result.eligible) {
      expect(result.fallback.message).toContain(
        "'Exclude In-Progress Conversions' is not supported",
      );
    }
  });

  it("message is verbatim for settings-outdated", async () => {
    const snapshotSettings = makeSnapshotSettings();
    const staleModel = {
      experimentSettingsHash: "stale",
      unitsTableFullName: "db.schema.units",
    } as unknown as IncrementalRefreshInterface;

    const result = await checkIncrementalRefreshEligibility({
      org: makeOrg(),
      integration: makeIntegration(),
      snapshotSettings,
      metricMap: makeMetricMap(),
      experiment: makeExperiment(),
      incrementalRefreshModel: staleModel,
      analysisType: "main-update",
    });
    expect(result.eligible).toBe(false);
    if (!result.eligible) {
      expect(result.fallback.message).toBe(
        "The experiment configuration is outdated. Please run a Full Refresh.",
      );
    }
  });
});
