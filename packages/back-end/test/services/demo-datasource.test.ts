import {
  DEMO_DATASOURCE_ID,
  DEMO_EXPERIMENT_ID,
  DEMO_EXPERIMENT_TRACKING_KEY,
  getDemoDatasourceFactTableIdForOrganization,
  getDemoDatasourcePageViewsFactTableIdForOrganization,
  getDemoDataSourceFeatureId,
  getDemoDatasourceProjectIdForOrganization,
  getDemoResourceIds,
} from "shared/demo-datasource";
import { DataSourceInterface } from "shared/types/datasource";
import { ExperimentInterface } from "shared/types/experiment";
import { FeatureInterface } from "shared/types/feature";
import { FactTableInterface } from "shared/types/fact-table";
import { ProjectInterface } from "shared/types/project";
import { ReqContext } from "back-end/types/request";
import {
  deleteDemoResources,
  isLegacyDemoSeed,
  seedDemoResources,
} from "back-end/src/services/demo-datasource";
import * as DataSourceModel from "back-end/src/models/DataSourceModel";
import * as ExperimentModel from "back-end/src/models/ExperimentModel";
import * as FeatureModel from "back-end/src/models/FeatureModel";
import * as FactTableModel from "back-end/src/models/FactTableModel";
import * as ExperimentSnapshotModel from "back-end/src/models/ExperimentSnapshotModel";
import * as MetricModel from "back-end/src/models/MetricModel";
import * as ExperimentsService from "back-end/src/services/experiments";
import * as RefreshFactTableColumns from "back-end/src/jobs/refreshFactTableColumns";

jest.mock("back-end/src/models/DataSourceModel", () => ({
  getDataSourceById: jest.fn(),
  createDataSource: jest.fn(),
  deleteDatasource: jest.fn(),
}));
jest.mock("back-end/src/models/ExperimentModel", () => ({
  getExperimentById: jest.fn(),
  createExperiment: jest.fn(),
  deleteExperimentByIdForOrganization: jest.fn(),
}));
jest.mock("back-end/src/models/FeatureModel", () => ({
  getFeature: jest.fn(),
  createFeature: jest.fn(),
  deleteFeature: jest.fn(),
}));
jest.mock("back-end/src/models/FactTableModel", () => ({
  getFactTable: jest.fn(),
  createFactTable: jest.fn(),
  deleteFactTable: jest.fn(),
  getFactTableMap: jest.fn(),
}));
jest.mock("back-end/src/models/ExperimentSnapshotModel", () => ({
  getLatestSuccessfulSnapshot: jest.fn(),
  deleteAllSnapshotsForExperiment: jest.fn(),
}));
jest.mock("back-end/src/models/MetricModel", () => ({
  getMetricMap: jest.fn(),
}));
jest.mock("back-end/src/services/experiments", () => ({
  createSnapshot: jest.fn(),
  getDefaultExperimentAnalysisSettings: jest.fn(),
}));
jest.mock("back-end/src/jobs/refreshFactTableColumns", () => ({
  queueFactTableColumnsRefresh: jest.fn(),
}));

const ORG_ID = "org_demotest";

const mocked = {
  getDataSourceById: DataSourceModel.getDataSourceById as jest.MockedFunction<
    typeof DataSourceModel.getDataSourceById
  >,
  createDataSource: DataSourceModel.createDataSource as jest.MockedFunction<
    typeof DataSourceModel.createDataSource
  >,
  deleteDatasource: DataSourceModel.deleteDatasource as jest.MockedFunction<
    typeof DataSourceModel.deleteDatasource
  >,
  getExperimentById: ExperimentModel.getExperimentById as jest.MockedFunction<
    typeof ExperimentModel.getExperimentById
  >,
  createExperiment: ExperimentModel.createExperiment as jest.MockedFunction<
    typeof ExperimentModel.createExperiment
  >,
  deleteExperimentByIdForOrganization:
    ExperimentModel.deleteExperimentByIdForOrganization as jest.MockedFunction<
      typeof ExperimentModel.deleteExperimentByIdForOrganization
    >,
  getFeature: FeatureModel.getFeature as jest.MockedFunction<
    typeof FeatureModel.getFeature
  >,
  createFeature: FeatureModel.createFeature as jest.MockedFunction<
    typeof FeatureModel.createFeature
  >,
  deleteFeature: FeatureModel.deleteFeature as jest.MockedFunction<
    typeof FeatureModel.deleteFeature
  >,
  getFactTable: FactTableModel.getFactTable as jest.MockedFunction<
    typeof FactTableModel.getFactTable
  >,
  createFactTable: FactTableModel.createFactTable as jest.MockedFunction<
    typeof FactTableModel.createFactTable
  >,
  deleteFactTable: FactTableModel.deleteFactTable as jest.MockedFunction<
    typeof FactTableModel.deleteFactTable
  >,
  getFactTableMap: FactTableModel.getFactTableMap as jest.MockedFunction<
    typeof FactTableModel.getFactTableMap
  >,
  getLatestSuccessfulSnapshot:
    ExperimentSnapshotModel.getLatestSuccessfulSnapshot as jest.MockedFunction<
      typeof ExperimentSnapshotModel.getLatestSuccessfulSnapshot
    >,
  deleteAllSnapshotsForExperiment:
    ExperimentSnapshotModel.deleteAllSnapshotsForExperiment as jest.MockedFunction<
      typeof ExperimentSnapshotModel.deleteAllSnapshotsForExperiment
    >,
  getMetricMap: MetricModel.getMetricMap as jest.MockedFunction<
    typeof MetricModel.getMetricMap
  >,
  createSnapshot: ExperimentsService.createSnapshot as jest.MockedFunction<
    typeof ExperimentsService.createSnapshot
  >,
  getDefaultExperimentAnalysisSettings:
    ExperimentsService.getDefaultExperimentAnalysisSettings as jest.MockedFunction<
      typeof ExperimentsService.getDefaultExperimentAnalysisSettings
    >,
  queueFactTableColumnsRefresh:
    RefreshFactTableColumns.queueFactTableColumnsRefresh as jest.MockedFunction<
      typeof RefreshFactTableColumns.queueFactTableColumnsRefresh
    >,
};

// In-memory stores keyed by resource id, reset per test. The model mocks
// read/write these so the service's exists-then-create logic is exercised
// end-to-end without a database.
let datasources: Map<string, DataSourceInterface>;
let experiments: Map<string, ExperimentInterface>;
let features: Map<string, FeatureInterface>;
let factTables: Map<string, FactTableInterface>;
let factMetrics: Map<string, { id: string }>;
let projects: Map<string, ProjectInterface>;

function makeContext(): ReqContext {
  return {
    org: { id: ORG_ID, settings: {} },
    userId: "u_tester",
    models: {
      projects: {
        getById: jest.fn(async (id: string) => projects.get(id) || null),
        create: jest.fn(async (data: Partial<ProjectInterface>) => {
          const doc = { ...data } as ProjectInterface;
          projects.set(doc.id, doc);
          return doc;
        }),
        deleteById: jest.fn(async (id: string) => {
          projects.delete(id);
        }),
      },
      factMetrics: {
        getById: jest.fn(async (id: string) => factMetrics.get(id) || null),
        create: jest.fn(async (data: { id: string }) => {
          factMetrics.set(data.id, data);
          return data;
        }),
        deleteById: jest.fn(async (id: string) => {
          factMetrics.delete(id);
        }),
      },
    },
  } as unknown as ReqContext;
}

beforeEach(() => {
  jest.clearAllMocks();

  datasources = new Map();
  experiments = new Map();
  features = new Map();
  factTables = new Map();
  factMetrics = new Map();
  projects = new Map();

  mocked.getDataSourceById.mockImplementation(
    async (_ctx, id) => datasources.get(id) || null,
  );
  mocked.createDataSource.mockImplementation(
    async (_ctx, name, type, _params, _settings, id) => {
      const doc = { id: id || "ds_random", name, type } as DataSourceInterface;
      datasources.set(doc.id, doc);
      return doc;
    },
  );
  mocked.deleteDatasource.mockImplementation(async (_ctx, ds) => {
    datasources.delete(ds.id);
  });

  mocked.getExperimentById.mockImplementation(
    async (_ctx, id) => experiments.get(id) || null,
  );
  mocked.createExperiment.mockImplementation(async ({ data }) => {
    const doc = { id: "exp_random", ...data } as ExperimentInterface;
    experiments.set(doc.id, doc);
    return doc;
  });
  mocked.deleteExperimentByIdForOrganization.mockImplementation(
    async (_ctx, experiment) => {
      experiments.delete(experiment.id);
    },
  );

  mocked.getFeature.mockImplementation(
    async (_ctx, id) => features.get(id) || null,
  );
  mocked.createFeature.mockImplementation(async (_ctx, feature) => {
    features.set(feature.id, feature);
  });
  mocked.deleteFeature.mockImplementation(async (_ctx, feature) => {
    features.delete(feature.id);
  });

  mocked.getFactTable.mockImplementation(
    async (_ctx, id) => factTables.get(id) || null,
  );
  mocked.createFactTable.mockImplementation(async (_ctx, data) => {
    const doc = data as FactTableInterface;
    factTables.set(doc.id, doc);
    return doc;
  });
  mocked.deleteFactTable.mockImplementation(async (_ctx, factTable) => {
    factTables.delete(factTable.id);
  });
  mocked.getFactTableMap.mockResolvedValue(new Map());

  mocked.getLatestSuccessfulSnapshot.mockResolvedValue(null);
  mocked.deleteAllSnapshotsForExperiment.mockResolvedValue(undefined);
  mocked.getMetricMap.mockResolvedValue(new Map());
  mocked.createSnapshot.mockResolvedValue(
    {} as Awaited<ReturnType<typeof ExperimentsService.createSnapshot>>,
  );
  mocked.getDefaultExperimentAnalysisSettings.mockReturnValue(
    {} as ReturnType<
      typeof ExperimentsService.getDefaultExperimentAnalysisSettings
    >,
  );
  mocked.queueFactTableColumnsRefresh.mockResolvedValue(undefined);
});

function seedAllStores() {
  const ids = getDemoResourceIds(ORG_ID);
  projects.set(ids.projectId, {
    id: ids.projectId,
    name: "Sample Data",
  } as ProjectInterface);
  datasources.set(ids.datasourceId, {
    id: ids.datasourceId,
  } as DataSourceInterface);
  ids.factTableIds.forEach((id) =>
    factTables.set(id, { id } as FactTableInterface),
  );
  ids.factMetricIds.forEach((id) => factMetrics.set(id, { id }));
  experiments.set(ids.experimentId, {
    id: ids.experimentId,
  } as ExperimentInterface);
  features.set(ids.featureId, { id: ids.featureId } as FeatureInterface);
}

describe("seedDemoResources", () => {
  it("creates every seeded resource with its constant or org-derived ID", async () => {
    const context = makeContext();
    const { project, experiment } = await seedDemoResources(context);

    expect(project.id).toBe(getDemoDatasourceProjectIdForOrganization(ORG_ID));
    expect(experiment.id).toBe(DEMO_EXPERIMENT_ID);
    expect(experiment.trackingKey).toBe(DEMO_EXPERIMENT_TRACKING_KEY);

    const ids = getDemoResourceIds(ORG_ID);
    expect(datasources.has(DEMO_DATASOURCE_ID)).toBe(true);
    expect([...factTables.keys()].sort()).toEqual(
      [
        getDemoDatasourceFactTableIdForOrganization(ORG_ID),
        getDemoDatasourcePageViewsFactTableIdForOrganization(ORG_ID),
      ].sort(),
    );
    expect([...factMetrics.keys()].sort()).toEqual(
      [...ids.factMetricIds].sort(),
    );
    expect(features.has(getDemoDataSourceFeatureId())).toBe(true);
    expect(mocked.createSnapshot).toHaveBeenCalledTimes(1);
  });

  it("is idempotent — a second run creates nothing new", async () => {
    const context = makeContext();
    await seedDemoResources(context);

    // The first run created a snapshot; report it as existing from now on.
    mocked.getLatestSuccessfulSnapshot.mockResolvedValue(
      {} as Awaited<
        ReturnType<typeof ExperimentSnapshotModel.getLatestSuccessfulSnapshot>
      >,
    );

    await seedDemoResources(context);

    expect(mocked.createDataSource).toHaveBeenCalledTimes(1);
    expect(mocked.createExperiment).toHaveBeenCalledTimes(1);
    expect(mocked.createFeature).toHaveBeenCalledTimes(1);
    expect(mocked.createFactTable).toHaveBeenCalledTimes(2);
    expect(context.models.factMetrics.create).toHaveBeenCalledTimes(4);
    expect(context.models.projects.create).toHaveBeenCalledTimes(1);
    expect(mocked.createSnapshot).toHaveBeenCalledTimes(1);
  });

  it("heals a partial seed by creating only the missing resources", async () => {
    seedAllStores();
    const ids = getDemoResourceIds(ORG_ID);
    // Simulate a partial seed: one fact metric and one fact table missing.
    factMetrics.delete(ids.factMetricIds[0]);
    factTables.delete(
      getDemoDatasourcePageViewsFactTableIdForOrganization(ORG_ID),
    );
    // The surviving experiment already has a snapshot.
    mocked.getLatestSuccessfulSnapshot.mockResolvedValue(
      {} as Awaited<
        ReturnType<typeof ExperimentSnapshotModel.getLatestSuccessfulSnapshot>
      >,
    );

    const context = makeContext();
    await seedDemoResources(context);

    expect(mocked.createDataSource).not.toHaveBeenCalled();
    expect(mocked.createExperiment).not.toHaveBeenCalled();
    expect(mocked.createFeature).not.toHaveBeenCalled();
    expect(mocked.createSnapshot).not.toHaveBeenCalled();
    expect(mocked.createFactTable).toHaveBeenCalledTimes(1);
    expect(context.models.factMetrics.create).toHaveBeenCalledTimes(1);
    expect(factMetrics.has(ids.factMetricIds[0])).toBe(true);
    expect(
      factTables.has(
        getDemoDatasourcePageViewsFactTableIdForOrganization(ORG_ID),
      ),
    ).toBe(true);
  });
});

describe("isLegacyDemoSeed", () => {
  it("returns true when neither the constant-ID datasource nor experiment exists", async () => {
    expect(await isLegacyDemoSeed(makeContext())).toBe(true);
  });

  it("returns false when the constant-ID datasource exists", async () => {
    datasources.set(DEMO_DATASOURCE_ID, {
      id: DEMO_DATASOURCE_ID,
    } as DataSourceInterface);
    expect(await isLegacyDemoSeed(makeContext())).toBe(false);
  });

  it("returns false when the constant-ID experiment exists", async () => {
    experiments.set(DEMO_EXPERIMENT_ID, {
      id: DEMO_EXPERIMENT_ID,
    } as ExperimentInterface);
    expect(await isLegacyDemoSeed(makeContext())).toBe(false);
  });
});

describe("deleteDemoResources", () => {
  it("deletes exactly the seeded set and leaves user resources alone", async () => {
    seedAllStores();
    // User-created resources, even ones living alongside the sample data.
    features.set("my-feature", { id: "my-feature" } as FeatureInterface);
    factMetrics.set("fact__mine", { id: "fact__mine" });
    experiments.set("exp_mine", { id: "exp_mine" } as ExperimentInterface);
    datasources.set("ds_mine", { id: "ds_mine" } as DataSourceInterface);
    factTables.set("ftb_mine", { id: "ftb_mine" } as FactTableInterface);

    const context = makeContext();
    await deleteDemoResources(context);

    const ids = getDemoResourceIds(ORG_ID);
    expect(features.has(ids.featureId)).toBe(false);
    expect(experiments.has(ids.experimentId)).toBe(false);
    expect(datasources.has(ids.datasourceId)).toBe(false);
    ids.factTableIds.forEach((id) => expect(factTables.has(id)).toBe(false));
    ids.factMetricIds.forEach((id) => expect(factMetrics.has(id)).toBe(false));
    expect(mocked.deleteAllSnapshotsForExperiment).toHaveBeenCalledWith(
      context,
      ids.experimentId,
    );

    expect(features.has("my-feature")).toBe(true);
    expect(factMetrics.has("fact__mine")).toBe(true);
    expect(experiments.has("exp_mine")).toBe(true);
    expect(datasources.has("ds_mine")).toBe(true);
    expect(factTables.has("ftb_mine")).toBe(true);
  });

  it("tolerates missing resources — deleting an empty org is a no-op", async () => {
    const context = makeContext();
    await expect(deleteDemoResources(context)).resolves.toBeUndefined();

    expect(mocked.deleteFeature).not.toHaveBeenCalled();
    expect(mocked.deleteExperimentByIdForOrganization).not.toHaveBeenCalled();
    expect(mocked.deleteFactTable).not.toHaveBeenCalled();
    expect(mocked.deleteDatasource).not.toHaveBeenCalled();
    expect(context.models.factMetrics.deleteById).not.toHaveBeenCalled();
  });

  it("deletes surviving seeded resources when some are already gone", async () => {
    seedAllStores();
    const ids = getDemoResourceIds(ORG_ID);
    // User already deleted the feature and the experiment by hand.
    features.delete(ids.featureId);
    experiments.delete(ids.experimentId);

    const context = makeContext();
    await deleteDemoResources(context);

    expect(mocked.deleteFeature).not.toHaveBeenCalled();
    expect(mocked.deleteExperimentByIdForOrganization).not.toHaveBeenCalled();
    expect(datasources.has(ids.datasourceId)).toBe(false);
    ids.factTableIds.forEach((id) => expect(factTables.has(id)).toBe(false));
    ids.factMetricIds.forEach((id) => expect(factMetrics.has(id)).toBe(false));
  });
});
