import {
  getExperimentSourceSnapshotRef,
  getIncrementalPipelineUnsupportedReason,
  isExperimentIncrementalEnabled,
  isNewerOverallResultsDataAvailable,
} from "shared/enterprise";
import type { ExperimentMetricInterface } from "shared/experiments";
import type { DataSourcePipelineSettings } from "shared/types/datasource";
import type { FactMetricInterface } from "shared/types/fact-table";

const makeSettings = (
  overrides: Partial<DataSourcePipelineSettings> = {},
): DataSourcePipelineSettings => ({
  allowWriting: true,
  mode: "incremental",
  ...overrides,
});

describe("isExperimentIncrementalEnabled", () => {
  describe("guards", () => {
    it("returns false when settings is undefined", () => {
      expect(
        isExperimentIncrementalEnabled(undefined, "exp_1", undefined),
      ).toBe(false);
    });

    it("returns false when allowWriting is false, even with opt-in", () => {
      expect(
        isExperimentIncrementalEnabled(
          makeSettings({
            allowWriting: false,
            mode: "ephemeral",
            incrementalOptInExperimentIds: ["exp_1"],
          }),
          "exp_1",
          undefined,
        ),
      ).toBe(false);
    });

    it("returns false when allowWriting is false in incremental mode", () => {
      expect(
        isExperimentIncrementalEnabled(
          makeSettings({ allowWriting: false }),
          "exp_1",
          undefined,
        ),
      ).toBe(false);
    });

    it("returns false for non-standard experiment types", () => {
      expect(
        isExperimentIncrementalEnabled(
          makeSettings(),
          "exp_1",
          "multi-armed-bandit",
        ),
      ).toBe(false);
      expect(
        isExperimentIncrementalEnabled(makeSettings(), "exp_1", "holdout"),
      ).toBe(false);
    });

    it("allows standard and undefined (legacy) experiment types", () => {
      expect(
        isExperimentIncrementalEnabled(makeSettings(), "exp_1", "standard"),
      ).toBe(true);
      expect(
        isExperimentIncrementalEnabled(makeSettings(), "exp_1", undefined),
      ).toBe(true);
    });
  });

  describe("mode: 'incremental'", () => {
    it("returns true by default (no scoping lists)", () => {
      expect(
        isExperimentIncrementalEnabled(makeSettings(), "exp_1", undefined),
      ).toBe(true);
    });

    it("returns false when experiment is in excludedExperimentIds", () => {
      expect(
        isExperimentIncrementalEnabled(
          makeSettings({ excludedExperimentIds: ["exp_1"] }),
          "exp_1",
          undefined,
        ),
      ).toBe(false);
    });

    it("returns true when includedExperimentIds includes the experiment", () => {
      expect(
        isExperimentIncrementalEnabled(
          makeSettings({ includedExperimentIds: ["exp_1"] }),
          "exp_1",
          undefined,
        ),
      ).toBe(true);
    });

    it("returns false when includedExperimentIds is set but does not include the experiment", () => {
      expect(
        isExperimentIncrementalEnabled(
          makeSettings({ includedExperimentIds: ["exp_other"] }),
          "exp_1",
          undefined,
        ),
      ).toBe(false);
    });

    it("ignores incrementalOptInExperimentIds (excluded wins)", () => {
      expect(
        isExperimentIncrementalEnabled(
          makeSettings({
            excludedExperimentIds: ["exp_1"],
            incrementalOptInExperimentIds: ["exp_1"],
          }),
          "exp_1",
          undefined,
        ),
      ).toBe(false);
    });

    it("ignores incrementalOptInExperimentIds when not in includes", () => {
      expect(
        isExperimentIncrementalEnabled(
          makeSettings({
            includedExperimentIds: ["exp_other"],
            incrementalOptInExperimentIds: ["exp_1"],
          }),
          "exp_1",
          undefined,
        ),
      ).toBe(false);
    });
  });

  describe("mode: 'ephemeral'", () => {
    it("returns true when experiment is in incrementalOptInExperimentIds", () => {
      expect(
        isExperimentIncrementalEnabled(
          makeSettings({
            mode: "ephemeral",
            incrementalOptInExperimentIds: ["exp_1"],
          }),
          "exp_1",
          undefined,
        ),
      ).toBe(true);
    });

    it("returns false when experiment is not in incrementalOptInExperimentIds", () => {
      expect(
        isExperimentIncrementalEnabled(
          makeSettings({
            mode: "ephemeral",
            incrementalOptInExperimentIds: ["exp_other"],
          }),
          "exp_1",
          undefined,
        ),
      ).toBe(false);
    });

    it("returns false when no opt-in list is set", () => {
      expect(
        isExperimentIncrementalEnabled(
          makeSettings({ mode: "ephemeral" }),
          "exp_1",
          undefined,
        ),
      ).toBe(false);
    });

    it("ignores includedExperimentIds and excludedExperimentIds", () => {
      // Only incrementalOptInExperimentIds matters in ephemeral mode.
      expect(
        isExperimentIncrementalEnabled(
          makeSettings({
            mode: "ephemeral",
            includedExperimentIds: ["exp_1"],
            excludedExperimentIds: ["exp_1"],
          }),
          "exp_1",
          undefined,
        ),
      ).toBe(false);
    });
  });
});

describe("getExperimentSourceSnapshotRef", () => {
  const mainDate = new Date("2024-06-01T12:00:00Z");

  it("returns undefined when no basis was persisted", () => {
    expect(getExperimentSourceSnapshotRef({})).toBeUndefined();
  });

  it("returns undefined when only the id is present", () => {
    expect(
      getExperimentSourceSnapshotRef({ sourceSnapshotId: "main" }),
    ).toBeUndefined();
  });

  it("returns undefined when only the date is present", () => {
    expect(
      getExperimentSourceSnapshotRef({ sourceSnapshotDateCreated: mainDate }),
    ).toBeUndefined();
  });

  it("returns the persisted ref when both id and date are present", () => {
    expect(
      getExperimentSourceSnapshotRef({
        sourceSnapshotId: "main",
        sourceSnapshotDateCreated: mainDate,
      }),
    ).toEqual({ id: "main", dateCreated: mainDate });
  });
});

describe("isNewerOverallResultsDataAvailable", () => {
  const source = {
    id: "main_old",
    dateCreated: new Date("2024-06-01T12:00:00Z"),
  };

  it("returns false when there is no source snapshot", () => {
    expect(
      isNewerOverallResultsDataAvailable(undefined, {
        dateCreated: new Date("2024-06-02T12:00:00Z"),
      }),
    ).toBe(false);
  });

  it("returns false when there is no latest main snapshot", () => {
    expect(isNewerOverallResultsDataAvailable(source, undefined)).toBe(false);
  });

  it("returns false when the latest main snapshot is the same age", () => {
    expect(
      isNewerOverallResultsDataAvailable(source, {
        dateCreated: source.dateCreated,
      }),
    ).toBe(false);
  });

  it("returns false when the latest main snapshot is older", () => {
    expect(
      isNewerOverallResultsDataAvailable(source, {
        dateCreated: new Date("2024-05-01T12:00:00Z"),
      }),
    ).toBe(false);
  });

  it("returns true when a newer main snapshot exists", () => {
    expect(
      isNewerOverallResultsDataAvailable(source, {
        dateCreated: new Date("2024-06-02T12:00:00Z"),
      }),
    ).toBe(true);
  });

  it("handles string dates from the API", () => {
    expect(
      isNewerOverallResultsDataAvailable(source, {
        dateCreated: "2024-06-02T12:00:00Z" as unknown as Date,
      }),
    ).toBe(true);
  });
});

const experimentId = "exp_1";

const makePipelineSettings = (
  overrides: Partial<DataSourcePipelineSettings> = {},
): DataSourcePipelineSettings => ({
  allowWriting: true,
  mode: "incremental",
  ...overrides,
});

const makeFactMetric = (
  overrides: Partial<FactMetricInterface> = {},
): FactMetricInterface =>
  ({
    id: "fact_m1",
    organization: "org_1",
    datasource: "ds_1",
    dateCreated: new Date(),
    dateUpdated: new Date(),
    name: "Test Fact Metric",
    description: "",
    owner: "owner",
    projects: [],
    tags: [],
    inverse: false,
    metricType: "mean",
    numerator: {
      factTableId: "ft_1",
      column: "value",
      aggregation: "sum",
      rowFilters: [],
    },
    denominator: null,
    cappingSettings: { type: "", value: 1000, ignoreZeros: false },
    windowSettings: {
      type: "",
      delayValue: 1,
      delayUnit: "days",
      windowValue: 1,
      windowUnit: "days",
    },
    priorSettings: {
      override: false,
      proper: false,
      mean: 0,
      stddev: 1,
    },
    quantileSettings: null,
    maxPercentChange: 100,
    minPercentChange: 0.1,
    minSampleSize: 100,
    targetMDE: 0.1,
    displayAsPercentage: false,
    winRisk: 0.1,
    loseRisk: 0.05,
    regressionAdjustmentOverride: true,
    regressionAdjustmentEnabled: false,
    regressionAdjustmentDays: 10,
    ...overrides,
  }) as FactMetricInterface;

const makeLegacyMetric = (): ExperimentMetricInterface =>
  ({
    id: "legacy_m1",
    organization: "org_1",
    datasource: "ds_1",
    name: "Legacy Metric",
    type: "binomial",
    sql: "SELECT 1",
  }) as ExperimentMetricInterface;

const makeEventQuantileMetric = (): FactMetricInterface =>
  makeFactMetric({
    id: "fact_quantile",
    metricType: "quantile",
    quantileSettings: {
      type: "event",
      quantile: 0.5,
      ignoreZeros: false,
    },
  });

const unsupportedReasonBaseParams = {
  datasourceProperties: {
    hasIncrementalRefresh: true,
    hasQuantileSketch: true,
  },
  pipelineSettings: makePipelineSettings(),
  experimentId,
  orgHasIncrementalPipelineFeature: true,
  skipPartialData: false,
  activationMetric: null,
  metrics: [makeFactMetric()],
  experimentType: "standard",
};

describe("getIncrementalPipelineUnsupportedReason", () => {
  it("returns null when all prerequisites are met", () => {
    expect(
      getIncrementalPipelineUnsupportedReason(unsupportedReasonBaseParams),
    ).toBeNull();
  });

  it("flags a data source without Incremental Pipeline support", () => {
    expect(
      getIncrementalPipelineUnsupportedReason({
        ...unsupportedReasonBaseParams,
        datasourceProperties: { hasIncrementalRefresh: false },
      }),
    ).toBe("The data source does not support Incremental Pipeline mode.");
  });

  it("flags an experiment excluded from incremental mode", () => {
    expect(
      getIncrementalPipelineUnsupportedReason({
        ...unsupportedReasonBaseParams,
        pipelineSettings: makePipelineSettings({
          excludedExperimentIds: [experimentId],
        }),
      }),
    ).toBe("Incremental Pipeline mode is not enabled for this experiment.");
  });

  it("flags orgs without the premium feature", () => {
    expect(
      getIncrementalPipelineUnsupportedReason({
        ...unsupportedReasonBaseParams,
        orgHasIncrementalPipelineFeature: false,
      }),
    ).toBe("Organization does not have access to Incremental Pipeline mode.");
  });

  it("flags exclude in-progress conversions", () => {
    expect(
      getIncrementalPipelineUnsupportedReason({
        ...unsupportedReasonBaseParams,
        skipPartialData: true,
      }),
    ).toBe(
      "'Exclude In-Progress Conversions' is not supported with Incremental Pipeline mode while in beta. Please select 'Include' in the Analysis Settings for Metric Conversion Windows.",
    );
  });

  it("flags a configured activation metric", () => {
    expect(
      getIncrementalPipelineUnsupportedReason({
        ...unsupportedReasonBaseParams,
        activationMetric: "fact_m1",
      }),
    ).toBe(
      "Activation metrics are not supported with Incremental Pipeline mode while in beta. Please remove the Activation Metric in the Analysis Settings.",
    );
  });

  it("flags an experiment with no metrics", () => {
    expect(
      getIncrementalPipelineUnsupportedReason({
        ...unsupportedReasonBaseParams,
        metrics: [],
      }),
    ).toBe("Experiment must have at least 1 metric.");
  });

  it("flags legacy metrics", () => {
    expect(
      getIncrementalPipelineUnsupportedReason({
        ...unsupportedReasonBaseParams,
        metrics: [makeLegacyMetric()],
      }),
    ).toBe(
      "Legacy metrics aren't supported with Incremental Pipeline mode. Convert them or remove non-Fact Metrics.",
    );
  });

  it("flags event quantile metrics on a data source without quantile sketches", () => {
    expect(
      getIncrementalPipelineUnsupportedReason({
        ...unsupportedReasonBaseParams,
        datasourceProperties: {
          hasIncrementalRefresh: true,
          hasQuantileSketch: false,
        },
        metrics: [makeEventQuantileMetric()],
      }),
    ).toBe(
      "Event quantile metrics are not supported with Incremental Pipeline mode on this data source.",
    );
  });

  it("allows event quantile metrics when the data source supports quantile sketches", () => {
    expect(
      getIncrementalPipelineUnsupportedReason({
        ...unsupportedReasonBaseParams,
        metrics: [makeEventQuantileMetric()],
      }),
    ).toBeNull();
  });

  it("returns the highest-priority reason when several apply", () => {
    expect(
      getIncrementalPipelineUnsupportedReason({
        datasourceProperties: { hasIncrementalRefresh: false },
        pipelineSettings: makePipelineSettings({
          excludedExperimentIds: [experimentId],
        }),
        experimentId,
        orgHasIncrementalPipelineFeature: false,
        skipPartialData: true,
        activationMetric: "fact_m1",
        metrics: [],
        experimentType: undefined,
      }),
    ).toBe("Organization does not have access to Incremental Pipeline mode.");
  });

  it("treats non-standard experiment types as not covered, coverage-first", () => {
    // Coverage prerequisites still outrank the type rejection.
    expect(
      getIncrementalPipelineUnsupportedReason({
        ...unsupportedReasonBaseParams,
        orgHasIncrementalPipelineFeature: false,
        experimentType: "multi-armed-bandit",
      }),
    ).toBe("Organization does not have access to Incremental Pipeline mode.");

    // Once the prerequisites pass, an unsupported type reads as not enabled.
    expect(
      getIncrementalPipelineUnsupportedReason({
        ...unsupportedReasonBaseParams,
        experimentType: "multi-armed-bandit",
      }),
    ).toBe("Incremental Pipeline mode is not enabled for this experiment.");
    expect(
      getIncrementalPipelineUnsupportedReason({
        ...unsupportedReasonBaseParams,
        experimentType: "holdout",
      }),
    ).toBe("Incremental Pipeline mode is not enabled for this experiment.");
  });

  it("still evaluates reasons for standard experiments", () => {
    expect(
      getIncrementalPipelineUnsupportedReason({
        ...unsupportedReasonBaseParams,
        experimentType: "standard",
        metrics: [makeLegacyMetric()],
      }),
    ).toBe(
      "Legacy metrics aren't supported with Incremental Pipeline mode. Convert them or remove non-Fact Metrics.",
    );
  });
});
