import request from "supertest";
import {
  getExperimentById,
  getExperimentByTrackingKey,
  createExperiment,
  getAllExperiments,
  updateExperiment,
} from "../../src/models/ExperimentModel";
import { getLatestSnapshot } from "../../src/models/ExperimentSnapshotModel";
import { getDataSourceById } from "../../src/models/DataSourceModel";
import { setupApp } from "./api.setup";

jest.mock("../../src/services/files", () => ({
  getSignedImageUrl: async (path) => `https://signed.example.com/${path}`,
}));

jest.mock("../../src/models/ExperimentModel", () => ({
  getExperimentById: jest.fn(),
  getExperimentByTrackingKey: jest.fn(),
  createExperiment: jest.fn(),
  updateExperiment: jest.fn(),
  getAllExperiments: jest.fn(),
}));

jest.mock("../../src/models/ExperimentSnapshotModel", () => ({
  getLatestSnapshot: jest.fn(),
}));

jest.mock("../../src/models/MetricModel", () => ({
  getMetricMap: jest.fn().mockResolvedValue(new Map()),
}));

jest.mock("../../src/models/DataSourceModel", () => ({
  getDataSourceById: jest.fn(),
}));

describe("experiments API", () => {
  const { app, setReqContext, updateReqContext } = setupApp();
  const org = {
    id: "org_1",
    settings: {},
    members: [],
  };

  afterEach(() => {
    jest.clearAllMocks();
  });

  beforeEach(() => {
    setReqContext({
      org,
      organization: org,
      models: {
        metricGroups: {
          getAll: jest.fn().mockResolvedValue([]),
        },
        decisionCriteria: {
          getById: jest.fn().mockResolvedValue(null),
        },
        projects: {
          getById: jest.fn().mockResolvedValue(null),
          getByIds: jest.fn().mockResolvedValue([]),
          ensureProjectsExist: jest.fn().mockResolvedValue(undefined),
        },
        dataSources: {
          getById: jest.fn().mockResolvedValue({
            id: "ds_123",
            type: "postgres",
            settings: {
              queries: { exposure: [{ id: "user_id", name: "User ID" }] },
            },
          }),
        },
      },
      permissions: {
        canViewExperiment: () => true,
        canCreateExperiment: () => true,
        canUpdateExperiment: () => true,
      },
    });
  });

  const experiment = {
    id: "exp_123",
    trackingKey: "exp_123",
    name: "Test Experiment",
    type: "standard",
    project: "proj_1",
    projects: [],
    hypothesis: "",
    description: "",
    tags: [],
    owner: "",
    dateCreated: new Date(),
    dateUpdated: new Date(),
    archived: false,
    status: "running",
    autoSnapshots: false,
    hashAttribute: "id",
    fallbackAttribute: undefined,
    hashVersion: 2,
    disableStickyBucketing: false,
    bucketVersion: undefined,
    minBucketVersion: undefined,
    variations: [
      {
        id: "0",
        key: "control",
        name: "Control",
        description: "",
        screenshots: [{ path: "img1.png" }, { path: "img2.png" }],
      },
    ],
    phases: [],
    goalMetrics: [],
    secondaryMetrics: [],
    guardrailMetrics: [],
    regressionAdjustmentEnabled: false,
    sequentialTestingEnabled: false,
    sequentialTestingTuningParameter: undefined,
    activationMetric: undefined,
    results: undefined,
    winner: undefined,
    analysis: undefined,
    releasedVariationId: undefined,
    excludeFromPayload: undefined,
    shareLevel: "organization",
    uid: undefined,
    banditScheduleValue: undefined,
    banditScheduleUnit: undefined,
    banditBurnInValue: undefined,
    banditBurnInUnit: undefined,
    linkedFeatures: [],
    hasVisualChangesets: false,
    hasURLRedirects: false,
    customFields: {},
  };

  describe("GET /api/v1/experiments/:id", () => {
    it("returns 200 with experiment details", async () => {
      (getExperimentById as jest.Mock).mockResolvedValue(experiment);
      const res = await request(app)
        .get("/api/v1/experiments/exp_123")
        .set("Authorization", "Bearer foo");

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("experiment");
      expect(res.body.experiment).toMatchObject({
        id: "exp_123",
        trackingKey: "exp_123",
        name: "Test Experiment",
        type: "standard",
        status: "running",
      });
    });

    it("returns 404 when experiment not found", async () => {
      (getExperimentById as jest.Mock).mockResolvedValue(null);
      const res = await request(app)
        .get("/api/v1/experiments/nonexistent")
        .set("Authorization", "Bearer foo");

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("message");
    });

    it("returns experiment with correct variation structure", async () => {
      (getExperimentById as jest.Mock).mockResolvedValue(experiment);
      const res = await request(app)
        .get("/api/v1/experiments/exp_123")
        .set("Authorization", "Bearer foo");

      expect(res.status).toBe(200);
      expect(res.body.experiment.variations).toHaveLength(1);
      expect(res.body.experiment.variations[0]).toMatchObject({
        variationId: "0",
        key: "control",
        name: "Control",
      });
    });

    it("returns experiment with phases", async () => {
      const experimentWithPhases = {
        ...experiment,
        phases: [
          {
            name: "Main",
            dateStarted: new Date("2024-01-01"),
            dateEnded: null,
            reason: "",
            seed: "test-seed",
            coverage: 1,
            variationWeights: [0.5, 0.5],
            condition: "",
            savedGroups: [],
            prerequisites: [],
            namespace: { enabled: false },
          },
        ],
      };
      (getExperimentById as jest.Mock).mockResolvedValue(experimentWithPhases);
      const res = await request(app)
        .get("/api/v1/experiments/exp_123")
        .set("Authorization", "Bearer foo");

      expect(res.status).toBe(200);
      expect(res.body.experiment.phases).toHaveLength(1);
      expect(res.body.experiment.phases[0]).toMatchObject({
        name: "Main",
        coverage: 1,
      });
    });

    it("returns experiment with draft status", async () => {
      const draftExperiment = { ...experiment, status: "draft" };
      (getExperimentById as jest.Mock).mockResolvedValue(draftExperiment);
      const res = await request(app)
        .get("/api/v1/experiments/exp_123")
        .set("Authorization", "Bearer foo");

      expect(res.status).toBe(200);
      expect(res.body.experiment.status).toBe("draft");
    });

    it("returns experiment with running status", async () => {
      const runningExperiment = { ...experiment, status: "running" };
      (getExperimentById as jest.Mock).mockResolvedValue(runningExperiment);
      const res = await request(app)
        .get("/api/v1/experiments/exp_123")
        .set("Authorization", "Bearer foo");

      expect(res.status).toBe(200);
      expect(res.body.experiment.status).toBe("running");
    });

    it("returns experiment with stopped status", async () => {
      const stoppedExperiment = {
        ...experiment,
        status: "stopped",
        results: "won",
        winner: 0,
        analysis: "Control variation won",
      };
      (getExperimentById as jest.Mock).mockResolvedValue(stoppedExperiment);
      const res = await request(app)
        .get("/api/v1/experiments/exp_123")
        .set("Authorization", "Bearer foo");

      expect(res.status).toBe(200);
      expect(res.body.experiment.status).toBe("stopped");
      expect(res.body.experiment.resultSummary).toBeDefined();
      expect(res.body.experiment.resultSummary.status).toBe("won");
    });

    it("returns experiment with multiple variations", async () => {
      const multiVariationExperiment = {
        ...experiment,
        variations: [
          {
            id: "0",
            key: "control",
            name: "Control",
            description: "Original version",
            screenshots: [],
          },
          {
            id: "1",
            key: "variation_1",
            name: "Variation 1",
            description: "First test variation",
            screenshots: [{ path: "var1.png" }],
          },
          {
            id: "2",
            key: "variation_2",
            name: "Variation 2",
            description: "Second test variation",
            screenshots: [],
          },
        ],
      };
      (getExperimentById as jest.Mock).mockResolvedValue(
        multiVariationExperiment,
      );
      const res = await request(app)
        .get("/api/v1/experiments/exp_123")
        .set("Authorization", "Bearer foo");

      expect(res.status).toBe(200);
      expect(res.body.experiment.variations).toHaveLength(3);
      expect(res.body.experiment.variations[0].variationId).toBe("0");
      expect(res.body.experiment.variations[1].variationId).toBe("1");
      expect(res.body.experiment.variations[2].variationId).toBe("2");
    });

    it("returns signed screenshot URLs", async () => {
      (getExperimentById as jest.Mock).mockResolvedValue(experiment);
      const res = await request(app)
        .get("/api/v1/experiments/exp_123")
        .set("Authorization", "Bearer foo");

      expect(res.status).toBe(200);
      expect(res.body.experiment.variations[0].screenshots).toEqual([
        "https://signed.example.com/img1.png",
        "https://signed.example.com/img2.png",
      ]);
    });

    it("returns experiment settings with correct structure", async () => {
      const experimentWithSettings = {
        ...experiment,
        datasource: "ds_test",
        exposureQueryId: "user_id",
        segment: "seg_123",
        goalMetrics: ["met_1", "met_2"],
        secondaryMetrics: ["met_3"],
        guardrailMetrics: ["met_4"],
        activationMetric: "met_activation",
      };
      (getExperimentById as jest.Mock).mockResolvedValue(
        experimentWithSettings,
      );
      const res = await request(app)
        .get("/api/v1/experiments/exp_123")
        .set("Authorization", "Bearer foo");

      expect(res.status).toBe(200);
      expect(res.body.experiment.settings).toBeDefined();
      expect(res.body.experiment.settings.datasourceId).toBe("ds_test");
      expect(res.body.experiment.settings.assignmentQueryId).toBe("user_id");
      expect(res.body.experiment.settings.goals).toHaveLength(2);
      expect(res.body.experiment.settings.secondaryMetrics).toHaveLength(1);
      expect(res.body.experiment.settings.guardrails).toHaveLength(1);
    });

    it("returns regression adjustment settings", async () => {
      const experimentWithRA = {
        ...experiment,
        regressionAdjustmentEnabled: true,
      };
      (getExperimentById as jest.Mock).mockResolvedValue(experimentWithRA);
      const res = await request(app)
        .get("/api/v1/experiments/exp_123")
        .set("Authorization", "Bearer foo");

      expect(res.status).toBe(200);
      expect(res.body.experiment.settings.regressionAdjustmentEnabled).toBe(
        true,
      );
    });

    it("returns sequential testing settings", async () => {
      const experimentWithST = {
        ...experiment,
        sequentialTestingEnabled: true,
        sequentialTestingTuningParameter: 5000,
      };
      (getExperimentById as jest.Mock).mockResolvedValue(experimentWithST);
      const res = await request(app)
        .get("/api/v1/experiments/exp_123")
        .set("Authorization", "Bearer foo");

      expect(res.status).toBe(200);
      expect(res.body.experiment.settings.sequentialTestingEnabled).toBe(true);
      expect(
        res.body.experiment.settings.sequentialTestingTuningParameter,
      ).toBe(5000);
    });

    it("returns archived experiment", async () => {
      const archivedExperiment = { ...experiment, archived: true };
      (getExperimentById as jest.Mock).mockResolvedValue(archivedExperiment);
      const res = await request(app)
        .get("/api/v1/experiments/exp_123")
        .set("Authorization", "Bearer foo");

      expect(res.status).toBe(200);
      expect(res.body.experiment.archived).toBe(true);
    });
  });

  describe("GET /api/v1/experiments", () => {
    it("returns signed screenshot URLs for all experiments", async () => {
      (getAllExperiments as jest.Mock).mockResolvedValue([experiment]);
      const res = await request(app)
        .get("/api/v1/experiments")
        .set("Authorization", "Bearer foo");

      expect(res.status).toBe(200);
      expect(res.body.experiments[0].variations[0].screenshots).toEqual([
        "https://signed.example.com/img1.png",
        "https://signed.example.com/img2.png",
      ]);
    });

    it("returns empty array when no experiments exist", async () => {
      (getAllExperiments as jest.Mock).mockResolvedValue([]);
      const res = await request(app)
        .get("/api/v1/experiments")
        .set("Authorization", "Bearer foo");

      expect(res.status).toBe(200);
      expect(res.body.experiments).toEqual([]);
    });

    it("returns multiple experiments", async () => {
      const experiment2 = {
        ...experiment,
        id: "exp_456",
        trackingKey: "exp_456",
        name: "Second Experiment",
      };
      (getAllExperiments as jest.Mock).mockResolvedValue([
        experiment,
        experiment2,
      ]);
      const res = await request(app)
        .get("/api/v1/experiments")
        .set("Authorization", "Bearer foo");

      expect(res.status).toBe(200);
      expect(res.body.experiments).toHaveLength(2);
      expect(res.body.experiments[0].id).toBe("exp_123");
      expect(res.body.experiments[1].id).toBe("exp_456");
    });

    it("filters experiments by project", async () => {
      const projectExperiment = { ...experiment, project: "proj_1" };
      (getAllExperiments as jest.Mock).mockResolvedValue([projectExperiment]);
      const res = await request(app)
        .get("/api/v1/experiments?projectId=proj_1")
        .set("Authorization", "Bearer foo");

      expect(res.status).toBe(200);
      expect(res.body.experiments).toHaveLength(1);
      expect(res.body.experiments[0].project).toBe("proj_1");
    });

    it("returns experiments with correct metadata", async () => {
      (getAllExperiments as jest.Mock).mockResolvedValue([experiment]);
      const res = await request(app)
        .get("/api/v1/experiments")
        .set("Authorization", "Bearer foo");

      expect(res.status).toBe(200);
      expect(res.body.experiments[0]).toHaveProperty("id");
      expect(res.body.experiments[0]).toHaveProperty("trackingKey");
      expect(res.body.experiments[0]).toHaveProperty("name");
      expect(res.body.experiments[0]).toHaveProperty("status");
      expect(res.body.experiments[0]).toHaveProperty("variations");
    });

    it("includes archived experiments in list when requested", async () => {
      const archivedExp = { ...experiment, archived: true };
      (getAllExperiments as jest.Mock).mockResolvedValue([
        experiment,
        archivedExp,
      ]);
      const res = await request(app)
        .get("/api/v1/experiments")
        .set("Authorization", "Bearer foo");

      expect(res.status).toBe(200);
      expect(res.body.experiments).toHaveLength(2);
    });
  });

  describe("POST /api/v1/experiments", () => {
    it("creates experiment with signed screenshot URLs", async () => {
      updateReqContext({
        org,
        models: {
          projects: {
            ensureProjectsExist: jest.fn().mockResolvedValue(undefined),
            getById: jest.fn().mockResolvedValue(null),
          },
        },
        permissions: {
          canCreateExperiment: () => true,
        },
      });

      (getDataSourceById as jest.Mock).mockResolvedValue({
        id: "ds_123",
        type: "postgres",
        settings: {
          queries: { exposure: [{ id: "user_id", name: "User ID" }] },
        },
      });
      (getExperimentByTrackingKey as jest.Mock).mockResolvedValue(null);
      (createExperiment as jest.Mock).mockResolvedValue(experiment);

      const createPayload = {
        trackingKey: "exp_new",
        name: "New Experiment",
        hypothesis: "This will increase conversions",
        datasourceId: "ds_123",
        assignmentQueryId: "user_id",
        variations: [
          {
            key: "control",
            name: "Control",
            description: "Original version",
            screenshots: [{ path: "img1.png" }, { path: "img2.png" }],
          },
          {
            key: "treatment",
            name: "Treatment",
            description: "New version",
            screenshots: [],
          },
        ],
      };

      const res = await request(app)
        .post("/api/v1/experiments")
        .send(createPayload)
        .set("Authorization", "Bearer foo");

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("experiment");
      expect(createExperiment).toHaveBeenCalled();
    });

    it("returns 400 when trackingKey already exists", async () => {
      (getExperimentByTrackingKey as jest.Mock).mockResolvedValue(experiment);

      const createPayload = {
        trackingKey: "exp_123",
        name: "Duplicate Experiment",
        hypothesis: "",
        assignmentQueryId: "user_id",
        variations: [
          {
            key: "control",
            name: "Control",
            description: "",
            screenshots: [],
          },
          {
            key: "treatment",
            name: "Treatment",
            description: "",
            screenshots: [],
          },
        ],
      };

      const res = await request(app)
        .post("/api/v1/experiments")
        .send(createPayload)
        .set("Authorization", "Bearer foo");

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("message");
      expect(res.body.message).toContain("already exists");
    });

    it("allows duplicate trackingKey when allowDuplicateTrackingKey is true", async () => {
      (getExperimentByTrackingKey as jest.Mock).mockResolvedValue(experiment);
      (createExperiment as jest.Mock).mockResolvedValue(experiment);

      const createPayload = {
        trackingKey: "exp_123",
        name: "Duplicate Experiment",
        hypothesis: "",
        assignmentQueryId: "user_id",
        allowDuplicateTrackingKey: true,
        variations: [
          {
            key: "control",
            name: "Control",
            description: "",
            screenshots: [],
          },
          {
            key: "treatment",
            name: "Treatment",
            description: "",
            screenshots: [],
          },
        ],
      };

      const res = await request(app)
        .post("/api/v1/experiments")
        .send(createPayload)
        .set("Authorization", "Bearer foo");

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("experiment");
      expect(getExperimentByTrackingKey).not.toHaveBeenCalled();
    });

    it("validates datasource exists", async () => {
      (getExperimentByTrackingKey as jest.Mock).mockResolvedValue(null);
      (getDataSourceById as jest.Mock).mockResolvedValue(null); // Mock datasource not found

      updateReqContext({
        org,
        organization: org,
        models: {
          decisionCriteria: {
            getById: jest.fn().mockResolvedValue(null),
          },
          projects: {
            getById: jest.fn().mockResolvedValue(null),
            ensureProjectsExist: jest.fn().mockResolvedValue(undefined),
          },
          dataSources: {
            getById: jest.fn().mockResolvedValue(null), // datasource not found
          },
        },
        permissions: {
          canViewExperiment: () => true,
          canCreateExperiment: () => true,
          canUpdateExperiment: () => true,
        },
      });

      const createPayload = {
        trackingKey: "exp_new",
        name: "New Experiment",
        hypothesis: "",
        datasourceId: "invalid_ds",
        assignmentQueryId: "user_id",
        variations: [
          {
            key: "control",
            name: "Control",
            description: "",
            screenshots: [],
          },
          {
            key: "treatment",
            name: "Treatment",
            description: "",
            screenshots: [],
          },
        ],
      };

      const res = await request(app)
        .post("/api/v1/experiments")
        .send(createPayload)
        .set("Authorization", "Bearer foo");

      expect(res.status).toBe(400);
      expect(res.body.message).toContain("Invalid data source");
    });
  });

  describe("POST /api/v1/experiments/:id", () => {
    it("updates experiment successfully", async () => {
      const updatedExperiment = {
        ...experiment,
        name: "Updated Experiment Name",
      };
      (getExperimentById as jest.Mock).mockResolvedValue(experiment);
      (updateExperiment as jest.Mock).mockResolvedValue(updatedExperiment);

      const updatePayload = {
        name: "Updated Experiment Name",
        hypothesis: "Updated hypothesis",
      };

      const res = await request(app)
        .post("/api/v1/experiments/exp_123")
        .send(updatePayload)
        .set("Authorization", "Bearer foo");

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("experiment");
      expect(res.body.experiment.name).toBe("Updated Experiment Name");
    });

    it("returns 400 when experiment not found", async () => {
      (getExperimentById as jest.Mock).mockResolvedValue(null);

      const updatePayload = {
        name: "Updated Name",
      };

      const res = await request(app)
        .post("/api/v1/experiments/nonexistent")
        .send(updatePayload)
        .set("Authorization", "Bearer foo");

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("message");
      expect(res.body.message).toContain("Could not find");
    });

    it("allows duplicate trackingKey on update when allowDuplicateTrackingKey is true", async () => {
      (getExperimentById as jest.Mock).mockResolvedValue(experiment);
      (updateExperiment as jest.Mock).mockResolvedValue({
        ...experiment,
        trackingKey: "existing_key",
      });

      const updatePayload = {
        trackingKey: "existing_key",
        allowDuplicateTrackingKey: true,
      };

      const res = await request(app)
        .post("/api/v1/experiments/exp_123")
        .send(updatePayload)
        .set("Authorization", "Bearer foo");

      expect(res.status).toBe(200);
      expect(getExperimentByTrackingKey).not.toHaveBeenCalled();
    });

    it("updates experiment variations with signed URLs", async () => {
      updateReqContext({
        org,
        models: {
          projects: {
            ensureProjectsExist: jest.fn().mockResolvedValue(undefined),
            getById: jest.fn().mockResolvedValue(null),
          },
          factMetrics: {
            getAll: jest.fn().mockResolvedValue([]),
          },
        },
        permissions: {
          canUpdateExperiment: () => true,
        },
      });

      (getDataSourceById as jest.Mock).mockResolvedValue({
        id: "ds_123",
        type: "postgres",
        settings: {
          queries: { exposure: [{ id: "user_id", name: "User ID" }] },
        },
      });

      const updatedExperiment = {
        ...experiment,
        variations: [
          {
            id: "0",
            key: "control",
            name: "Updated Control",
            description: "",
            screenshots: [
              { path: "new_screenshot1.png" },
              { path: "new_screenshot2.png" },
            ],
          },
          {
            id: "1",
            key: "variation",
            name: "Variation",
            description: "",
            screenshots: [],
          },
        ],
      };
      (getExperimentById as jest.Mock).mockResolvedValue(experiment);
      (updateExperiment as jest.Mock).mockResolvedValue(updatedExperiment);

      const updatePayload = {
        variations: [
          {
            variationId: "0",
            key: "control",
            name: "Updated Control",
            description: "",
            screenshots: [
              { path: "new_screenshot1.png" },
              { path: "new_screenshot2.png" },
            ],
          },
          {
            variationId: "1",
            key: "variation",
            name: "Variation",
            description: "",
            screenshots: [],
          },
        ],
      };

      const res = await request(app)
        .post("/api/v1/experiments/exp_123")
        .send(updatePayload)
        .set("Authorization", "Bearer foo");

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("experiment");
      expect(res.body.experiment.variations[0].screenshots).toEqual([
        "https://signed.example.com/new_screenshot1.png",
        "https://signed.example.com/new_screenshot2.png",
      ]);
    });
  });

  describe("GET /api/v1/experiments/:id/results", () => {
    it("returns experiment results", async () => {
      updateReqContext({
        org,
        permissions: {
          canViewExperiment: () => true,
        },
      });

      const experimentWithPhases = {
        ...experiment,
        phases: [
          {
            name: "Main",
            dateStarted: new Date("2024-01-01"),
            dateEnded: null,
            reason: "",
            seed: "test-seed",
            coverage: 1,
            variationWeights: [0.5, 0.5],
            condition: "",
            savedGroups: [],
            prerequisites: [],
            namespace: { enabled: false },
          },
        ],
      };
      (getExperimentById as jest.Mock).mockResolvedValue(experimentWithPhases);
      (getLatestSnapshot as jest.Mock).mockResolvedValue({
        id: "snap_123",
        organization: "org_1",
        experiment: "exp_123",
        phase: 0,
        dimension: null,
        dateCreated: new Date(),
        runStarted: new Date(),
        queries: [],
        unknownVariations: [],
        multipleExposures: 0,
        hasCorrectedStats: false,
        results: [],
        settings: {
          manual: false,
          activationMetric: null,
          queryFilter: "",
          segment: "",
          skipPartialData: false,
          attributionModel: "firstExposure",
          experimentId: "exp_123",
          statsEngine: "bayesian",
          regressionAdjustmentEnabled: false,
          sequentialTestingEnabled: false,
          sequentialTestingTuningParameter: 5000,
          pValueThreshold: 0.05,
          pValueCorrection: null,
          differenceType: "relative",
        },
      });

      const res = await request(app)
        .get("/api/v1/experiments/exp_123/results")
        .set("Authorization", "Bearer foo");

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("result");
    });

    it("returns 400 when experiment not found", async () => {
      (getExperimentById as jest.Mock).mockResolvedValue(null);

      const res = await request(app)
        .get("/api/v1/experiments/nonexistent/results")
        .set("Authorization", "Bearer foo");

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("message");
    });

    it("returns 400 when no results found", async () => {
      (getExperimentById as jest.Mock).mockResolvedValue(experiment);
      (getLatestSnapshot as jest.Mock).mockResolvedValue(null);

      const res = await request(app)
        .get("/api/v1/experiments/exp_123/results")
        .set("Authorization", "Bearer foo");

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("message");
      expect(res.body.message).toContain("No results found");
    });
  });
});
