import request from "supertest";
import { cloneDeep } from "lodash";
import {
  getDataSourceById,
  getDataSourcesByOrganization,
} from "../../src/models/DataSourceModel";

import { getUserByEmail } from "../../src/models/UserModel";
import { upsertWatch } from "../../src/models/WatchModel";
import { setupApp } from "./api.setup";

jest.mock("../../src/models/DataSourceModel", () => ({
  getDataSourceById: jest.fn(),
  getDataSourcesByOrganization: jest.fn(),
}));

jest.mock("../../src/models/UserModel", () => ({
  getUserByEmail: jest.fn(),
}));

jest.mock("../../src/models/WatchModel", () => ({
  upsertWatch: jest.fn(),
}));

jest.mock("../../src/models/OrganizationModel", () => ({
  updateOrganization: jest.fn(),
}));

describe("postExperiments API", () => {
  const { app, auditMock, setReqContext } = setupApp();

  const variations = [
    {
      key: "control",
      name: "Control",
      description: "Control variation",
    },
    {
      key: "treatment",
      name: "Treatment",
      description: "Treatment variation",
    },
  ];

  const requestData = {
    owner: "test@example.com",
    trackingKey: "test-experiment" as string | undefined,
    datasourceId: "ds123" as string | undefined,
    assignmentQueryId: "anonymous_id" as string | undefined,
    name: "Test Experiment",
    hypothesis: "This is a test hypothesis",
    description: "This is a test description",
    variations: variations,
  };

  const org = {
    id: "org123",
    settings: {},
    members: [{ id: "user123" }, { id: "user456" }],
  };

  const expectedResults = expect.objectContaining({
    experiment: expect.objectContaining({
      id: expect.any(String),
      name: "Test Experiment",
      project: "",
      hypothesis: "This is a test hypothesis",
      description: "This is a test description",
      tags: [],
      owner: "user456",
      dateCreated: expect.any(String),
      dateUpdated: expect.any(String),
      archived: false,
      status: "draft",
      autoRefresh: true,
      hashAttribute: "id",
      hashVersion: 2,
      variations: [
        {
          variationId: expect.any(String),
          key: "control",
          name: "Control",
          description: "Control variation",
          screenshots: [],
        },
        {
          variationId: expect.any(String),
          key: "treatment",
          name: "Treatment",
          description: "Treatment variation",
          screenshots: [],
        },
      ],
      phases: [
        {
          name: "Main",
          dateStarted: expect.any(String),
          dateEnded: "",
          reasonForStopping: "",
          seed: expect.any(String),
          coverage: 1,
          trafficSplit: [
            {
              variationId: expect.any(String),
              weight: 0.5,
            },
            {
              variationId: expect.any(String),
              weight: 0.5,
            },
          ],
          targetingCondition: "",
          savedGroupTargeting: [],
        },
      ],
      settings: {
        datasourceId: "ds123",
        assignmentQueryId: "anonymous_id",
        experimentId: "test-experiment",
        segmentId: "",
        queryFilter: "",
        inProgressConversions: "include",
        attributionModel: "firstExposure",
        statsEngine: "bayesian",
        goals: [],
        secondaryMetrics: [],
        guardrails: [],
        regressionAdjustmentEnabled: false,
      },
    }),
  });

  afterEach(async () => {
    jest.clearAllMocks();
  });

  describe("POST /api/v1/experiments", () => {
    describe("when the user does not have correct permissions", () => {
      beforeEach(() => {
        setReqContext({
          user: { id: "user123" },
          org,
          permissions: {
            canCreateExperiment: jest.fn().mockReturnValue(false),
            throwPermissionError: jest.fn().mockImplementation(() => {
              throw new Error("Permission denied");
            }),
          },
        });
      });

      it("should throw an error if user does not have permission", async () => {
        const response = await request(app)
          .post("/api/v1/experiments")
          .send(requestData)
          .set("Authorization", "Bearer test-token");

        expect(response.body).toEqual({
          message: "Permission denied",
        });
        expect(response.status).toBe(400);
      });
    });

    describe("when the user has correct permissions", () => {
      beforeEach(() => {
        setReqContext({
          user: { id: "user123" },
          org,
          permissions: {
            canCreateExperiment: jest.fn().mockReturnValue(true),
          },
        });
      });

      it("should create an experiment successfully", async () => {
        (getDataSourceById as jest.Mock).mockResolvedValue({
          id: "ds123",
          settings: { queries: { exposure: [{ id: "anonymous_id" }] } },
        });

        (getUserByEmail as jest.Mock).mockResolvedValue({
          id: "user456",
        });
        const response = await request(app)
          .post("/api/v1/experiments")
          .send(requestData)
          .set("Authorization", "Bearer test-token");

        expect(response.body).toEqual(expectedResults);
        expect(response.status).toBe(200);
        expect(upsertWatch).toHaveBeenCalled();
        expect(auditMock).toHaveBeenCalledWith({
          event: "experiment.create",
          entity: {
            object: "experiment",
            id: expect.any(String),
          },
          details: expect.any(String),
        });
      });

      it("should throw an error if the user is not a member of the organization", async () => {
        (getDataSourceById as jest.Mock).mockResolvedValue({
          id: "ds123",
          settings: {
            queries: { exposure: [{ id: "anonymous_id" }] },
          },
        });

        (getUserByEmail as jest.Mock).mockResolvedValue({
          id: "user789",
        });
        const response = await request(app)
          .post("/api/v1/experiments")
          .send(requestData)
          .set("Authorization", "Bearer test-token");

        expect(response.body).toEqual({
          message: "Unable to find user: test@example.com.",
        });
        expect(response.status).toBe(400);
      });

      it("should thrown an error if assignment query is not provided and default is not found", async () => {
        const mockDatasources = [
          {
            id: "ds123",
            settings: { queries: { exposure: [{ id: "user_id" }] } },
          },
        ];

        (getDataSourcesByOrganization as jest.Mock).mockResolvedValue(
          mockDatasources
        );

        (getUserByEmail as jest.Mock).mockResolvedValue({
          id: "user456",
        });

        const requestData2 = cloneDeep(requestData);
        delete requestData2.datasourceId;
        delete requestData2.assignmentQueryId;

        const response = await request(app)
          .post("/api/v1/experiments")
          .send(requestData2)
          .set("Authorization", "Bearer test-token");

        expect(response.body).toEqual({
          message:
            "Assignment query ID is not set and default assignment query ID not found",
        });
        expect(response.status).toBe(400);
      });

      it("should thrown an error if datasrouce is not provided and default is not found", async () => {
        (getDataSourcesByOrganization as jest.Mock).mockResolvedValue([]);

        (getUserByEmail as jest.Mock).mockResolvedValue({
          id: "user456",
        });

        const requestData2 = { ...requestData };
        delete requestData2.datasourceId;
        delete requestData2.assignmentQueryId;

        const response = await request(app)
          .post("/api/v1/experiments")
          .send(requestData2)
          .set("Authorization", "Bearer test-token");

        expect(response.body).toEqual({
          message:
            "Data source ID is not set and default data source not found",
        });
        expect(response.status).toBe(400);
      });

      it("should use default datasource and assignment query if not provided", async () => {
        const mockDatasources = [
          {
            id: "ds123",
            settings: { queries: { exposure: [{ id: "anonymous_id" }] } },
          },
        ];

        (getDataSourcesByOrganization as jest.Mock).mockResolvedValue(
          mockDatasources
        );

        (getUserByEmail as jest.Mock).mockResolvedValue({
          id: "user456",
        });

        const requestData2 = { ...requestData };
        delete requestData2.datasourceId;
        delete requestData2.assignmentQueryId;

        const response = await request(app)
          .post("/api/v1/experiments")
          .send(requestData2)
          .set("Authorization", "Bearer test-token");

        expect(response.body).toEqual(expectedResults);
        expect(response.status).toBe(200);
      });

      it("should create a tracking key if none is passed", async () => {
        (getDataSourceById as jest.Mock).mockResolvedValue({
          id: "ds123",
          settings: { queries: { exposure: [{ id: "anonymous_id" }] } },
        });

        (getUserByEmail as jest.Mock).mockResolvedValue({
          id: "user456",
        });

        const requestData2 = cloneDeep(requestData);
        delete requestData2.trackingKey;

        const response = await request(app)
          .post("/api/v1/experiments")
          .send(requestData)
          .set("Authorization", "Bearer test-token");

        expect(response.body).toEqual(expectedResults);
        expect(response.status).toBe(200);
      });
    });

    /*

    it("should use default datasource and assignment query if not provided", async () => {
      const mockContext = {
        userId: "user123",
        permissions: {
          canCreateExperiment: jest.fn().mockReturnValue(true),
        },
      };

      const mockOrganization = {
        id: "org123",
        settings: {},
        members: [{ id: "user123" }, { id: "user456" }],
      };

      setReqContext({
        context: mockContext,
        organization: mockOrganization,
      });

      const mockDatasources = [
        { id: "ds456", settings: { queries: { exposure: [{ id: "aq456" }] } } },
      ];

      (DataSourceModel.getDataSourcesByOrganization as jest.Mock).mockResolvedValue(
        mockDatasources
      );
      (getNewExperimentDatasourceDefaults as jest.Mock).mockReturnValue({
        datasource: "ds456",
        exposureQueryId: "aq456",
      });
      (ExperimentModel.getExperimentByTrackingKey as jest.Mock).mockResolvedValue(
        null
      );
      (UserModel.getUserByEmail as jest.Mock).mockResolvedValue({
        id: "user456",
      });
      (ExperimentModel.createExperiment as jest.Mock).mockResolvedValue({
        id: "exp456",
      });
      (experimentServices.toExperimentApiInterface as jest.Mock).mockResolvedValue(
        {
          id: "exp456",
          name: "Test Experiment",
        }
      );

      const response = await app
        .post("/api/v1/experiments")
        .send({
          owner: "test@example.com",
          trackingKey: "test-experiment",
          project: "test-project",
        })
        .set("Authorization", "Bearer test-token");

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        experiment: { id: "exp456", name: "Test Experiment" },
      });
      expect(DataSourceModel.getDataSourcesByOrganization).toHaveBeenCalled();
      expect(getNewExperimentDatasourceDefaults).toHaveBeenCalled();
    });

    it("should throw an error if tracking key already exists", async () => {
      setReqContext({
        context: {
          userId: "user123",
          permissions: {
            canCreateExperiment: jest.fn().mockReturnValue(true),
          },
        },
      });

      (ExperimentModel.getExperimentByTrackingKey as jest.Mock).mockResolvedValue(
        { id: "existing-exp" }
      );

      const response = await app
        .post("/api/v1/experiments")
        .send({
          owner: "test@example.com",
          trackingKey: "test-experiment",
          project: "test-project",
          datasourceId: "ds123",
          assignmentQueryId: "aq123",
        })
        .set("Authorization", "Bearer test-token");

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        message: "Experiment with tracking key already exists: test-experiment",
      });
    });

    it("should throw an error if owner email is invalid", async () => {
      setReqContext({
        context: {
          userId: "user123",
          permissions: {
            canCreateExperiment: jest.fn().mockReturnValue(true),
          },
        },
        organization: {
          id: "org123",
          members: [{ id: "user123" }],
        },
      });

      (DataSourceModel.getDataSourceById as jest.Mock).mockResolvedValue({
        id: "ds123",
        settings: { queries: { exposure: [{ id: "aq123" }] } },
      });
      (ExperimentModel.getExperimentByTrackingKey as jest.Mock).mockResolvedValue(
        null
      );
      (UserModel.getUserByEmail as jest.Mock).mockResolvedValue(null);

      const response = await app
        .post("/api/v1/experiments")
        .send({
          owner: "test@example.com",
          trackingKey: "test-experiment",
          project: "test-project",
          datasourceId: "ds123",
          assignmentQueryId: "aq123",
        })
        .set("Authorization", "Bearer test-token");

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        message: "Unable to find user: test@example.com.",
      });
    });
    */
  });
});
