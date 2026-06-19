import { ExperimentSnapshotSettings } from "shared/types/experiment-snapshot";
import { ExperimentInterface } from "shared/types/experiment";
import { OrganizationInterface } from "shared/types/organization";
import { IncrementalRefreshInterface } from "shared/validators";
import { SourceIntegrationInterface } from "back-end/src/types/Integration";
import { orgHasPremiumFeature } from "back-end/src/enterprise";
import { IncrementalUpdateRequiresFullRefreshError } from "back-end/src/util/errors";
import {
  getExperimentSettingsHashForIncrementalRefresh,
  assertIncrementalRefreshPrerequisites,
  getFactTablesNeedingRebuild,
} from "back-end/src/enterprise/services/data-pipeline";
import { planMetricFanOut } from "back-end/src/services/experimentQueries/planMetricFanOut";
import { factMetricFactory } from "../factories/FactMetric.factory";

jest.mock("back-end/src/enterprise", () => ({
  orgHasPremiumFeature: jest.fn(),
}));

const orgHasPremiumFeatureMock = orgHasPremiumFeature as jest.MockedFunction<
  typeof orgHasPremiumFeature
>;

function makeSnapshotSettings(
  overrides: Partial<ExperimentSnapshotSettings> = {},
): ExperimentSnapshotSettings {
  return {
    dimensions: [],
    metricSettings: [{ id: "m1" }],
    goalMetrics: ["m1"],
    secondaryMetrics: [],
    guardrailMetrics: [],
    activationMetric: null,
    defaultMetricPriorSettings: {},
    regressionAdjustmentEnabled: false,
    attributionModel: "firstExposure",
    experimentId: "exp_123",
    queryFilter: "",
    segment: "",
    skipPartialData: false,
    datasourceId: "ds_123",
    exposureQueryId: "exposure_1",
    startDate: new Date("2024-01-01"),
    endDate: new Date("2024-12-31"),
    variations: [],
    ...overrides,
  } as ExperimentSnapshotSettings;
}

function makeIntegration(): SourceIntegrationInterface {
  return {
    datasource: {
      settings: {
        pipelineSettings: {
          allowWriting: true,
          mode: "incremental",
        },
      },
    },
    getSourceProperties: () => ({
      hasIncrementalRefresh: true,
      hasQuantileSketch: true,
    }),
  } as unknown as SourceIntegrationInterface;
}

function makeIncrementalRefreshModel(
  overrides: Partial<IncrementalRefreshInterface> = {},
): IncrementalRefreshInterface {
  return {
    id: "ir_123",
    organization: "org_123",
    experimentId: "exp_123",
    unitsTableFullName: "proj.ds.gb_units_exp_123",
    unitsMaxTimestamp: new Date("2024-06-01"),
    unitsDimensions: [],
    metricSources: [],
    metricCovariateSources: [],
    experimentSettingsHash: getExperimentSettingsHashForIncrementalRefresh(
      makeSnapshotSettings(),
    ),
    currentExecutionSnapshotId: null,
    dateCreated: new Date(),
    dateUpdated: new Date(),
    ...overrides,
  };
}

describe("assertIncrementalRefreshPrerequisites experimentSettingsHash", () => {
  const metric = factMetricFactory.build({ id: "m1" });
  const metricMap = new Map([[metric.id, metric]]);
  const org = { id: "org_123" } as OrganizationInterface;
  const experiment = {
    id: "exp_123",
    activationMetric: undefined,
  } as ExperimentInterface;
  const integration = makeIntegration();

  beforeEach(() => {
    orgHasPremiumFeatureMock.mockReturnValue(true);
  });

  it("allows main-update when the stored hash matches", async () => {
    const snapshotSettings = makeSnapshotSettings();
    await expect(
      assertIncrementalRefreshPrerequisites({
        org,
        integration,
        snapshotSettings,
        metricMap,
        experiment,
        incrementalRefreshModel: makeIncrementalRefreshModel({
          experimentSettingsHash:
            getExperimentSettingsHashForIncrementalRefresh(snapshotSettings),
        }),
        analysisType: "main-update",
      }),
    ).resolves.toBeUndefined();
  });

  it("throws on main-update when experimentSettingsHash is null", async () => {
    await expect(
      assertIncrementalRefreshPrerequisites({
        org,
        integration,
        snapshotSettings: makeSnapshotSettings(),
        metricMap,
        experiment,
        incrementalRefreshModel: makeIncrementalRefreshModel({
          experimentSettingsHash: null,
        }),
        analysisType: "main-update",
      }),
    ).rejects.toThrow(IncrementalUpdateRequiresFullRefreshError);
  });

  it("throws on main-update when the stored hash differs", async () => {
    await expect(
      assertIncrementalRefreshPrerequisites({
        org,
        integration,
        snapshotSettings: makeSnapshotSettings({ segment: "seg_changed" }),
        metricMap,
        experiment,
        incrementalRefreshModel: makeIncrementalRefreshModel({
          experimentSettingsHash: "stale_hash",
        }),
        analysisType: "main-update",
      }),
    ).rejects.toThrow(IncrementalUpdateRequiresFullRefreshError);
  });

  it("skips hash validation on exploratory even when the stored hash differs", async () => {
    await expect(
      assertIncrementalRefreshPrerequisites({
        org,
        integration,
        snapshotSettings: makeSnapshotSettings({ segment: "seg_changed" }),
        metricMap,
        experiment,
        incrementalRefreshModel: makeIncrementalRefreshModel({
          experimentSettingsHash: "stale_hash",
        }),
        analysisType: "exploratory",
      }),
    ).resolves.toBeUndefined();
  });

  it("allows exploratory when the stored hash matches", async () => {
    const snapshotSettings = makeSnapshotSettings();
    await expect(
      assertIncrementalRefreshPrerequisites({
        org,
        integration,
        snapshotSettings,
        metricMap,
        experiment,
        incrementalRefreshModel: makeIncrementalRefreshModel({
          experimentSettingsHash:
            getExperimentSettingsHashForIncrementalRefresh(snapshotSettings),
        }),
        analysisType: "exploratory",
      }),
    ).resolves.toBeUndefined();
  });

  it("skips hash validation on main-fullRefresh even when hash is null", async () => {
    await expect(
      assertIncrementalRefreshPrerequisites({
        org,
        integration,
        snapshotSettings: makeSnapshotSettings(),
        metricMap,
        experiment,
        incrementalRefreshModel: makeIncrementalRefreshModel({
          experimentSettingsHash: null,
        }),
        analysisType: "main-fullRefresh",
      }),
    ).resolves.toBeUndefined();
  });
});

type ExistingMetricSource =
  IncrementalRefreshInterface["metricSources"][number];

function makeMetricSource(
  groupId: string,
  factTableId: string,
  metrics: { id: string; settingsHash: string }[],
): ExistingMetricSource {
  return {
    groupId,
    factTableId,
    metrics,
    maxTimestamp: null,
    tableFullName: `proj.ds.${groupId}`,
  };
}

describe("getFactTablesNeedingRebuild", () => {
  const sameFtMetric = factMetricFactory.build({
    id: "m_same_ft",
    metricType: "mean",
    numerator: { factTableId: "ft_a", column: "amount" },
  });
  const otherFtMetric = factMetricFactory.build({
    id: "m_other_ft",
    metricType: "mean",
    numerator: { factTableId: "ft_b", column: "amount" },
  });
  const crossFtMetric = factMetricFactory.build({
    id: "m_cross_ft",
    metricType: "ratio",
    numerator: { factTableId: "ft_num", column: "amount" },
    denominator: { factTableId: "ft_denom", column: "tenure" },
  });

  it("returns an empty set on a first run (no existing sources)", () => {
    const rebuild = getFactTablesNeedingRebuild({
      existingMetricSources: [],
      desiredFanOut: planMetricFanOut([sameFtMetric]),
      currentMetricSettingsHashes: new Map([["m_same_ft", "h1"]]),
    });
    expect(rebuild.size).toBe(0);
  });

  it("does not flag a metric whose settings hash is unchanged", () => {
    const rebuild = getFactTablesNeedingRebuild({
      existingMetricSources: [
        makeMetricSource("grp_a", "ft_a", [
          { id: "m_same_ft", settingsHash: "h1" },
        ]),
      ],
      desiredFanOut: planMetricFanOut([sameFtMetric]),
      currentMetricSettingsHashes: new Map([["m_same_ft", "h1"]]),
    });
    expect(rebuild.size).toBe(0);
  });

  it("flags rebuild when a desired metric is missing from currentMetricSettingsHashes", () => {
    const rebuild = getFactTablesNeedingRebuild({
      existingMetricSources: [
        makeMetricSource("grp_a", "ft_a", [
          { id: "m_same_ft", settingsHash: "h1" },
        ]),
      ],
      desiredFanOut: planMetricFanOut([sameFtMetric]),
      currentMetricSettingsHashes: new Map(),
    });
    expect([...rebuild]).toEqual(["ft_a"]);
  });

  it("flags the fact table of a metric whose settings hash changed", () => {
    const rebuild = getFactTablesNeedingRebuild({
      existingMetricSources: [
        makeMetricSource("grp_a", "ft_a", [
          { id: "m_same_ft", settingsHash: "old" },
        ]),
      ],
      desiredFanOut: planMetricFanOut([sameFtMetric]),
      currentMetricSettingsHashes: new Map([["m_same_ft", "new"]]),
    });
    expect([...rebuild]).toEqual(["ft_a"]);
  });

  it("only flags the changed metric's fact table, leaving others incremental", () => {
    const rebuild = getFactTablesNeedingRebuild({
      existingMetricSources: [
        makeMetricSource("grp_a", "ft_a", [
          { id: "m_same_ft", settingsHash: "h1" },
        ]),
        makeMetricSource("grp_b", "ft_b", [
          { id: "m_other_ft", settingsHash: "old" },
        ]),
      ],
      desiredFanOut: planMetricFanOut([sameFtMetric, otherFtMetric]),
      currentMetricSettingsHashes: new Map([
        ["m_same_ft", "h1"],
        ["m_other_ft", "new"],
      ]),
    });
    expect([...rebuild]).toEqual(["ft_b"]);
  });

  it("flags a fact table that gained a new metric", () => {
    const rebuild = getFactTablesNeedingRebuild({
      existingMetricSources: [
        makeMetricSource("grp_a", "ft_a", [
          { id: "m_same_ft", settingsHash: "h1" },
        ]),
      ],
      desiredFanOut: planMetricFanOut([
        sameFtMetric,
        factMetricFactory.build({
          id: "m_added",
          metricType: "mean",
          numerator: { factTableId: "ft_a", column: "amount" },
        }),
      ]),
      currentMetricSettingsHashes: new Map([
        ["m_same_ft", "h1"],
        ["m_added", "h2"],
      ]),
    });
    expect([...rebuild]).toEqual(["ft_a"]);
  });

  it("flags a fact table that lost a metric", () => {
    const rebuild = getFactTablesNeedingRebuild({
      existingMetricSources: [
        makeMetricSource("grp_a", "ft_a", [
          { id: "m_same_ft", settingsHash: "h1" },
          { id: "m_removed", settingsHash: "h2" },
        ]),
      ],
      desiredFanOut: planMetricFanOut([sameFtMetric]),
      currentMetricSettingsHashes: new Map([["m_same_ft", "h1"]]),
    });
    expect([...rebuild]).toEqual(["ft_a"]);
  });

  it("flags both sides when a cross-FT ratio metric's settings changed", () => {
    const rebuild = getFactTablesNeedingRebuild({
      existingMetricSources: [
        makeMetricSource("grp_num", "ft_num", [
          { id: "m_cross_ft", settingsHash: "old" },
        ]),
        makeMetricSource("grp_denom", "ft_denom", [
          { id: "m_cross_ft", settingsHash: "old" },
        ]),
      ],
      desiredFanOut: planMetricFanOut([crossFtMetric]),
      currentMetricSettingsHashes: new Map([["m_cross_ft", "new"]]),
    });
    expect([...rebuild].sort()).toEqual(["ft_denom", "ft_num"]);
  });

  it("flags only the missing denominator side when cross-FT numerator cache already exists", () => {
    const rebuild = getFactTablesNeedingRebuild({
      existingMetricSources: [
        makeMetricSource("grp_num", "ft_num", [
          { id: "m_cross_ft", settingsHash: "h1" },
        ]),
      ],
      desiredFanOut: planMetricFanOut([crossFtMetric]),
      currentMetricSettingsHashes: new Map([["m_cross_ft", "h1"]]),
    });
    expect([...rebuild]).toEqual(["ft_denom"]);
  });

  it("flags the shared numerator FT and new denominator FT when cross-FT is added beside an unchanged same-FT metric", () => {
    const sharedNumFtMetric = factMetricFactory.build({
      id: "m_same_on_num",
      metricType: "mean",
      numerator: { factTableId: "ft_num", column: "sessions" },
    });
    const crossFtOnSharedNum = factMetricFactory.build({
      id: "m_cross_ft",
      metricType: "ratio",
      numerator: { factTableId: "ft_num", column: "amount" },
      denominator: { factTableId: "ft_denom", column: "tenure" },
    });

    const rebuild = getFactTablesNeedingRebuild({
      existingMetricSources: [
        makeMetricSource("grp_num", "ft_num", [
          { id: "m_same_on_num", settingsHash: "h_same" },
        ]),
      ],
      desiredFanOut: planMetricFanOut([sharedNumFtMetric, crossFtOnSharedNum]),
      currentMetricSettingsHashes: new Map([
        ["m_same_on_num", "h_same"],
        ["m_cross_ft", "h_cross"],
      ]),
    });
    expect([...rebuild].sort()).toEqual(["ft_denom", "ft_num"]);
  });
});
