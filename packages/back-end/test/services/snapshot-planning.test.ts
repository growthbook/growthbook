import { ExperimentMetricInterface } from "shared/experiments";
import { ExperimentInterface } from "shared/types/experiment";
import { DataSourceInterface } from "shared/types/datasource";
import { ExperimentSnapshotAnalysisSettings } from "shared/types/experiment-snapshot";
import { ApiReqContext } from "back-end/types/api";
import {
  getSnapshotQueryRunnerKind,
  planSnapshot,
} from "back-end/src/services/experiments";
import { updateExperiment } from "back-end/src/models/ExperimentModel";
import { createExperimentSnapshotModel } from "back-end/src/models/ExperimentSnapshotModel";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { getSourceIntegrationObject } from "back-end/src/services/datasource";
import { updateExperimentDashboards } from "back-end/src/enterprise/services/dashboards";
import { FactTableMap } from "back-end/src/models/FactTableModel";

jest.mock("back-end/src/models/ExperimentModel", () => ({
  updateExperiment: jest.fn(),
}));

jest.mock("back-end/src/models/ExperimentSnapshotModel", () => ({
  createExperimentSnapshotModel: jest.fn(),
}));

jest.mock("back-end/src/models/DataSourceModel", () => ({
  getDataSourceById: jest.fn(),
}));

jest.mock("back-end/src/services/datasource", () => ({
  getIntegrationFromDatasourceId: jest.fn(),
  getSourceIntegrationObject: jest.fn(),
}));

jest.mock("back-end/src/enterprise/services/dashboards", () => ({
  updateExperimentDashboards: jest.fn(),
}));

const updateExperimentMock = updateExperiment as jest.MockedFunction<
  typeof updateExperiment
>;
const createExperimentSnapshotModelMock =
  createExperimentSnapshotModel as jest.MockedFunction<
    typeof createExperimentSnapshotModel
  >;
const getDataSourceByIdMock = getDataSourceById as jest.MockedFunction<
  typeof getDataSourceById
>;
const getSourceIntegrationObjectMock =
  getSourceIntegrationObject as jest.MockedFunction<
    typeof getSourceIntegrationObject
  >;
const updateExperimentDashboardsMock =
  updateExperimentDashboards as jest.MockedFunction<
    typeof updateExperimentDashboards
  >;

function makeContext(): ApiReqContext {
  return {
    org: {
      id: "org_123",
      settings: {},
    },
    models: {
      metricGroups: {
        getAll: jest.fn().mockResolvedValue([]),
      },
    },
  } as unknown as ApiReqContext;
}

function makeDatasource(
  overrides: Partial<DataSourceInterface> = {},
): DataSourceInterface {
  return {
    id: "ds_123",
    type: "postgres",
    settings: {
      queries: {},
      ...overrides.settings,
    },
    ...overrides,
  } as unknown as DataSourceInterface;
}

function makeExperiment(
  overrides: Partial<ExperimentInterface> = {},
): ExperimentInterface {
  return {
    id: "exp_123",
    organization: "org_123",
    datasource: "ds_123",
    project: "",
    owner: "",
    tags: [],
    type: "standard",
    variations: [{ name: "Control" }, { name: "Treatment" }],
    phases: [
      {
        dateStarted: new Date("2025-01-01T00:00:00.000Z"),
        variationWeights: [0.5, 0.5],
      },
    ],
    goalMetrics: [],
    secondaryMetrics: [],
    guardrailMetrics: [],
    metricOverrides: {},
    ...overrides,
  } as unknown as ExperimentInterface;
}

function makeAnalysisSettings(
  overrides: Partial<ExperimentSnapshotAnalysisSettings> = {},
): ExperimentSnapshotAnalysisSettings {
  return {
    dimensions: [],
    statsEngine: "bayesian",
    numGoalMetrics: 1,
    numGuardrailMetrics: 0,
    differenceType: "relative",
    ...overrides,
  } as ExperimentSnapshotAnalysisSettings;
}

describe("snapshot planning", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getDataSourceByIdMock.mockResolvedValue(makeDatasource());
    getSourceIntegrationObjectMock.mockReturnValue({} as never);
  });

  const incrementalDatasource = {
    settings: {
      pipelineSettings: {
        mode: "incremental",
      },
    },
  } as unknown as DataSourceInterface;

  it("forces the standard results runner when incremental refresh is disabled", () => {
    const experiment = { type: "standard" } as unknown as ExperimentInterface;

    expect(
      getSnapshotQueryRunnerKind({
        allowIncrementalRefresh: false,
        isExperimentCompatibleWithIncrementalRefresh: true,
        datasource: incrementalDatasource,
        experiment,
        snapshotType: "standard",
        hasSnapshotDimensions: false,
        hasMaterializedUnitsTable: true,
      }),
    ).toBe("results");
  });

  it("uses the incremental runner for eligible standard snapshots", () => {
    const experiment = { type: "standard" } as unknown as ExperimentInterface;

    expect(
      getSnapshotQueryRunnerKind({
        allowIncrementalRefresh: true,
        isExperimentCompatibleWithIncrementalRefresh: true,
        datasource: incrementalDatasource,
        experiment,
        snapshotType: "standard",
        hasSnapshotDimensions: false,
        hasMaterializedUnitsTable: true,
      }),
    ).toBe("incremental");
  });

  it("uses the exploratory incremental runner for eligible exploratory snapshots", () => {
    const experiment = { type: "standard" } as unknown as ExperimentInterface;

    expect(
      getSnapshotQueryRunnerKind({
        allowIncrementalRefresh: true,
        isExperimentCompatibleWithIncrementalRefresh: true,
        datasource: incrementalDatasource,
        experiment,
        snapshotType: "exploratory",
        hasSnapshotDimensions: true,
        hasMaterializedUnitsTable: true,
      }),
    ).toBe("incremental-exploratory");
  });

  it("uses the incremental runner for exploratory snapshots with no dimensions", () => {
    const experiment = { type: "standard" } as unknown as ExperimentInterface;

    expect(
      getSnapshotQueryRunnerKind({
        allowIncrementalRefresh: true,
        isExperimentCompatibleWithIncrementalRefresh: true,
        datasource: incrementalDatasource,
        experiment,
        snapshotType: "exploratory",
        hasSnapshotDimensions: false,
        hasMaterializedUnitsTable: true,
      }),
    ).toBe("incremental");
  });

  it("falls back to the standard results runner for unsupported experiment types", () => {
    const experiment = {
      type: "multi-armed-bandit",
    } as unknown as ExperimentInterface;

    expect(
      getSnapshotQueryRunnerKind({
        allowIncrementalRefresh: true,
        isExperimentCompatibleWithIncrementalRefresh: true,
        datasource: incrementalDatasource,
        experiment,
        snapshotType: "standard",
        hasSnapshotDimensions: false,
        hasMaterializedUnitsTable: true,
      }),
    ).toBe("results");
  });

  it("plans a draft snapshot without persisting or mutating experiment state", async () => {
    const plan = await planSnapshot({
      experiment: makeExperiment(),
      context: makeContext(),
      type: "standard",
      triggeredBy: "manual-dashboard",
      phaseIndex: 0,
      useCache: false,
      defaultAnalysisSettings: makeAnalysisSettings(),
      additionalAnalysisSettings: [],
      settingsForSnapshotMetrics: [],
      metricMap: new Map<string, ExperimentMetricInterface>(),
      factTableMap: new Map() as FactTableMap,
      allowIncrementalRefresh: false,
    });

    expect(plan.runnerKind).toBe("results");
    expect(plan.snapshot.status).toBe("running");
    expect(plan.snapshot.triggeredBy).toBe("manual-dashboard");
    expect(plan.snapshot.analyses).toHaveLength(1);
    expect(createExperimentSnapshotModelMock).not.toHaveBeenCalled();
    expect(updateExperimentMock).not.toHaveBeenCalled();
    expect(updateExperimentDashboardsMock).not.toHaveBeenCalled();
  });
});
