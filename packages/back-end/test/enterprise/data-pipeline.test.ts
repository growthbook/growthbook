import { ExperimentSnapshotSettings } from "shared/types/experiment-snapshot";
import { ExperimentInterface } from "shared/types/experiment";
import { OrganizationInterface } from "shared/types/organization";
import { IncrementalRefreshInterface } from "shared/validators";
import { SourceIntegrationInterface } from "back-end/src/types/Integration";
import { ReqContext } from "back-end/types/request";
import { orgHasPremiumFeature } from "back-end/src/enterprise";
import { ExperimentIncrementalPipelineRequiresFullRefreshError } from "back-end/src/util/errors";
import {
  getExperimentSettingsHashForIncrementalRefresh,
  assertIncrementalRefreshPrerequisites,
  getFactTablesNeedingRebuild,
  exploratoryOverallRequiresFullRefresh,
  ResolvedSettingsRefs,
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

const baseRefs: ResolvedSettingsRefs = {
  segment: null,
  exposureQuerySql: "select * from exposures",
};

function segmentRefs(sql: string): ResolvedSettingsRefs {
  return {
    ...baseRefs,
    segment: {
      sql,
      factTableId: undefined,
      filters: undefined,
      userIdType: "user_id",
    },
  };
}

function makeIntegration(): SourceIntegrationInterface {
  return {
    datasource: {
      settings: {
        pipelineSettings: {
          allowWriting: true,
          mode: "incremental",
        },
        queries: {
          exposure: [{ id: "exposure_1", query: baseRefs.exposureQuerySql }],
        },
      },
    },
    getSourceProperties: () => ({
      hasIncrementalRefresh: true,
      hasQuantileSketch: true,
    }),
  } as unknown as SourceIntegrationInterface;
}

function makeContext(segmentSql?: string): ReqContext {
  return {
    org: { id: "org_123" } as OrganizationInterface,
    models: {
      segments: {
        getById: jest
          .fn()
          .mockResolvedValue(
            segmentSql
              ? { id: "seg_1", sql: segmentSql, userIdType: "user_id" }
              : null,
          ),
      },
    },
  } as unknown as ReqContext;
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
      baseRefs,
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
  const context = makeContext();
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
        context,
        integration,
        snapshotSettings,
        metricMap,
        experiment,
        incrementalRefreshModel: makeIncrementalRefreshModel({
          experimentSettingsHash:
            getExperimentSettingsHashForIncrementalRefresh(
              snapshotSettings,
              baseRefs,
            ),
        }),
        analysisType: "main-update",
      }),
    ).resolves.toBeUndefined();
  });

  it("throws on main-update when experimentSettingsHash is null", async () => {
    await expect(
      assertIncrementalRefreshPrerequisites({
        context,
        integration,
        snapshotSettings: makeSnapshotSettings(),
        metricMap,
        experiment,
        incrementalRefreshModel: makeIncrementalRefreshModel({
          experimentSettingsHash: null,
        }),
        analysisType: "main-update",
      }),
    ).rejects.toThrow(ExperimentIncrementalPipelineRequiresFullRefreshError);
  });

  it("throws on main-update when the stored hash differs", async () => {
    await expect(
      assertIncrementalRefreshPrerequisites({
        context,
        integration,
        snapshotSettings: makeSnapshotSettings({ segment: "seg_changed" }),
        metricMap,
        experiment,
        incrementalRefreshModel: makeIncrementalRefreshModel({
          experimentSettingsHash: "stale_hash",
        }),
        analysisType: "main-update",
      }),
    ).rejects.toThrow(ExperimentIncrementalPipelineRequiresFullRefreshError);
  });

  it("skips hash validation on exploratory even when the stored hash differs", async () => {
    await expect(
      assertIncrementalRefreshPrerequisites({
        context,
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
        context,
        integration,
        snapshotSettings,
        metricMap,
        experiment,
        incrementalRefreshModel: makeIncrementalRefreshModel({
          experimentSettingsHash:
            getExperimentSettingsHashForIncrementalRefresh(
              snapshotSettings,
              baseRefs,
            ),
        }),
        analysisType: "exploratory",
      }),
    ).resolves.toBeUndefined();
  });

  it("skips hash validation on main-fullRefresh even when hash is null", async () => {
    await expect(
      assertIncrementalRefreshPrerequisites({
        context,
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

  it("throws when segment SQL changes but the segment ID is unchanged", async () => {
    const snapshotSettings = makeSnapshotSettings({ segment: "seg_1" });
    const storedHash = getExperimentSettingsHashForIncrementalRefresh(
      snapshotSettings,
      segmentRefs("select user_id from t where plan = 'pro'"),
    );
    await expect(
      assertIncrementalRefreshPrerequisites({
        context: makeContext("select user_id from t where plan = 'team'"),
        integration,
        snapshotSettings,
        metricMap,
        experiment,
        incrementalRefreshModel: makeIncrementalRefreshModel({
          experimentSettingsHash: storedHash,
        }),
        analysisType: "main-update",
      }),
    ).rejects.toThrow(ExperimentIncrementalPipelineRequiresFullRefreshError);
  });

  it("allows main-update when segment SQL is unchanged", async () => {
    const snapshotSettings = makeSnapshotSettings({ segment: "seg_1" });
    const storedHash = getExperimentSettingsHashForIncrementalRefresh(
      snapshotSettings,
      segmentRefs("select user_id from t where plan = 'pro'"),
    );
    await expect(
      assertIncrementalRefreshPrerequisites({
        context: makeContext("select user_id from t where plan = 'pro'"),
        integration,
        snapshotSettings,
        metricMap,
        experiment,
        incrementalRefreshModel: makeIncrementalRefreshModel({
          experimentSettingsHash: storedHash,
        }),
        analysisType: "main-update",
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

// A hash change forces existing incremental experiments into full refresh.
describe("getExperimentSettingsHashForIncrementalRefresh — output hash", () => {
  const GOLDEN_INPUT: ExperimentSnapshotSettings = {
    activationMetric: null,
    attributionModel: "firstExposure",
    queryFilter: "",
    segment: "",
    skipPartialData: false,
    datasourceId: "ds_123",
    exposureQueryId: "exposure_1",
    startDate: new Date("2024-01-01T00:00:00.000Z"),
    regressionAdjustmentEnabled: false,
    experimentId: "exp_123",
    dimensions: [],
    metricSettings: [],
    goalMetrics: [],
    secondaryMetrics: [],
    guardrailMetrics: [],
    defaultMetricPriorSettings: {},
    endDate: new Date("2024-12-31T00:00:00.000Z"),
    variations: [],
  } as ExperimentSnapshotSettings;

  const GOLDEN_REFS: ResolvedSettingsRefs = {
    segment: null,
    exposureQuerySql: "select * from exposures",
  };

  it("produces the pinned md5 for the fixed input", () => {
    expect(
      getExperimentSettingsHashForIncrementalRefresh(GOLDEN_INPUT, GOLDEN_REFS),
    ).toBe("929ca8f2ff79e4121a1d4945eaafefb6");
  });

  it("changes when only the resolved exposure-query SQL changes", () => {
    expect(
      getExperimentSettingsHashForIncrementalRefresh(GOLDEN_INPUT, {
        ...GOLDEN_REFS,
        exposureQuerySql: "select * from exposures_v2",
      }),
    ).not.toBe(
      getExperimentSettingsHashForIncrementalRefresh(GOLDEN_INPUT, GOLDEN_REFS),
    );
  });

  it("changes when only a FACT segment's filters change", () => {
    const factSegment = (filters: string[]): ResolvedSettingsRefs => ({
      ...GOLDEN_REFS,
      segment: {
        sql: undefined,
        factTableId: "ft_users",
        filters,
        userIdType: "user_id",
      },
    });
    expect(
      getExperimentSettingsHashForIncrementalRefresh(
        GOLDEN_INPUT,
        factSegment(["filt_a"]),
      ),
    ).not.toBe(
      getExperimentSettingsHashForIncrementalRefresh(
        GOLDEN_INPUT,
        factSegment(["filt_b"]),
      ),
    );
  });
});

describe("exploratoryOverallRequiresFullRefresh", () => {
  it("returns true when the experiment settings hash drifted", () => {
    expect(
      exploratoryOverallRequiresFullRefresh({
        snapshotSettings: makeSnapshotSettings({ metricSettings: [] }),
        refs: baseRefs,
        incrementalRefreshModel: makeIncrementalRefreshModel({
          experimentSettingsHash: "stale_hash",
        }),
        latestOverallSnapshotId: null,
      }),
    ).toBe(true);
  });

  it("returns true when there is no stored settings hash", () => {
    expect(
      exploratoryOverallRequiresFullRefresh({
        snapshotSettings: makeSnapshotSettings({ metricSettings: [] }),
        refs: baseRefs,
        incrementalRefreshModel: makeIncrementalRefreshModel({
          experimentSettingsHash: "",
        }),
        latestOverallSnapshotId: null,
      }),
    ).toBe(true);
  });

  it("returns false when the hash matches even though a metric is not cached", () => {
    const settingsWithMetric = makeSnapshotSettings({
      metricSettings: [{ id: "m1" }],
    });
    expect(
      exploratoryOverallRequiresFullRefresh({
        snapshotSettings: settingsWithMetric,
        refs: baseRefs,
        incrementalRefreshModel: makeIncrementalRefreshModel({
          experimentSettingsHash:
            getExperimentSettingsHashForIncrementalRefresh(
              settingsWithMetric,
              baseRefs,
            ),
          metricSources: [],
        }),
        latestOverallSnapshotId: null,
      }),
    ).toBe(false);
  });

  it("returns true when hash matches but latest overall snapshot differs from materializer", () => {
    const settings = makeSnapshotSettings({ metricSettings: [] });
    expect(
      exploratoryOverallRequiresFullRefresh({
        snapshotSettings: settings,
        refs: baseRefs,
        incrementalRefreshModel: makeIncrementalRefreshModel({
          experimentSettingsHash:
            getExperimentSettingsHashForIncrementalRefresh(settings, baseRefs),
          materializedBySnapshotId: "snp_old",
        }),
        latestOverallSnapshotId: "snp_new",
      }),
    ).toBe(true);
  });

  it("returns false when hash matches and latest overall snapshot equals materializer", () => {
    const settings = makeSnapshotSettings({ metricSettings: [] });
    expect(
      exploratoryOverallRequiresFullRefresh({
        snapshotSettings: settings,
        refs: baseRefs,
        incrementalRefreshModel: makeIncrementalRefreshModel({
          experimentSettingsHash:
            getExperimentSettingsHashForIncrementalRefresh(settings, baseRefs),
          materializedBySnapshotId: "snp_old",
        }),
        latestOverallSnapshotId: "snp_old",
      }),
    ).toBe(false);
  });

  it("returns false when hash matches and no materializedBySnapshotId (legacy)", () => {
    const settings = makeSnapshotSettings({ metricSettings: [] });
    expect(
      exploratoryOverallRequiresFullRefresh({
        snapshotSettings: settings,
        refs: baseRefs,
        incrementalRefreshModel: makeIncrementalRefreshModel({
          experimentSettingsHash:
            getExperimentSettingsHashForIncrementalRefresh(settings, baseRefs),
          materializedBySnapshotId: undefined,
        }),
        latestOverallSnapshotId: "snp_new",
      }),
    ).toBe(false);
  });
});
