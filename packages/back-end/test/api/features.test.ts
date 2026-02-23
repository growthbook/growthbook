import request from "supertest";
import { FeatureInterface } from "shared/types/feature";
import {
  createFeature,
  getFeature,
  updateFeature,
} from "back-end/src/models/FeatureModel";
import {
  createRevision,
  getRevision,
} from "back-end/src/models/FeatureRevisionModel";
import { getExperimentMapForFeature } from "back-end/src/models/ExperimentModel";
import { addTags } from "back-end/src/models/TagModel";
import {
  getSavedGroupMap,
  getApiFeatureObj,
  createInterfaceEnvSettingsFromApiEnvSettings,
  updateInterfaceEnvSettingsFromApiEnvSettings,
  getNextScheduledUpdate,
} from "back-end/src/services/features";
import { setupApp } from "./api.setup";

jest.mock("back-end/src/models/FeatureModel", () => ({
  getFeature: jest.fn(),
  createFeature: jest.fn(),
  updateFeature: jest.fn(),
}));

jest.mock("back-end/src/models/TagModel", () => ({
  addTags: jest.fn(),
  addTagsDiff: jest.fn(),
}));

jest.mock("back-end/src/models/ExperimentModel", () => ({
  getExperimentMapForFeature: jest.fn(),
}));

jest.mock("back-end/src/models/FeatureRevisionModel", () => ({
  createRevision: jest.fn(),
  getRevision: jest.fn(),
}));

jest.mock("back-end/src/services/features", () => ({
  getApiFeatureObj: jest.fn(),
  getSavedGroupMap: jest.fn(),
  getNextScheduledUpdate: jest.fn(),
  addIdsToRules: jest.fn(),
  createInterfaceEnvSettingsFromApiEnvSettings: jest.fn(),
  updateInterfaceEnvSettingsFromApiEnvSettings: jest.fn(),
}));

describe("features API", () => {
  const { app, auditMock, setReqContext } = setupApp();
  const org = { id: "org", settings: { environments: [{ id: "production" }] } };

  beforeEach(() => {
    (getApiFeatureObj as jest.Mock).mockImplementation((v) => v);
    (getSavedGroupMap as jest.Mock).mockResolvedValue("savedGroupMap");
    (getExperimentMapForFeature as jest.Mock).mockResolvedValue(new Map());
    (getRevision as jest.Mock).mockResolvedValue(null);
    (getNextScheduledUpdate as jest.Mock).mockReturnValue(null);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("can create new features", async () => {
    setReqContext({
      org,
      models: {
        safeRollout: {
          getAllPayloadSafeRollouts: jest.fn().mockResolvedValue(new Map()),
        },
      },
      permissions: {
        canPublishFeature: () => true,
        canCreateFeature: () => true,
      },
      getProjects: async () => [{ id: "project" }],
    });

    (createFeature as jest.Mock).mockImplementation((v) => v);
    (getFeature as jest.Mock).mockReturnValue(undefined);
    (addTags as jest.Mock).mockReturnValue(undefined);
    (createInterfaceEnvSettingsFromApiEnvSettings as jest.Mock).mockReturnValue(
      "createInterfaceEnvSettingsFromApiEnvSettings",
    );
    (getSavedGroupMap as jest.Mock).mockResolvedValue("savedGroupMap");
    (getApiFeatureObj as jest.Mock).mockImplementation((v) => v);

    const feature = {
      defaultValue: "defaultValue",
      valueType: "string",
      owner: "owner",
      description: "description",
      project: "project",
      id: "id",
      archived: true,
      tags: ["tag"],
    };

    const response = await request(app)
      .post("/api/v1/features")
      .send(feature)
      .set("Authorization", "Bearer foo");
    expect(response.status).toBe(200);
    expect(getApiFeatureObj).toHaveBeenCalled();
    expect(addTags).toHaveBeenCalledWith("org", ["tag"]);
    expect(response.body).toEqual(
      expect.objectContaining({
        feature: expect.objectContaining({
          experimentMap: {},
          feature: expect.objectContaining({
            archived: true,
            dateCreated: expect.any(String),
            dateUpdated: expect.any(String),
            defaultValue: "defaultValue",
            description: "description",
            environmentSettings: "createInterfaceEnvSettingsFromApiEnvSettings",
            prerequisites: [],
            id: "id",
            jsonSchema: expect.objectContaining({
              date: expect.any(String),
              enabled: false,
              schema: "",
              schemaType: "schema",
              simple: { fields: [], type: "object" },
            }),
            organization: "org",
            owner: "owner",
            project: "project",
            tags: ["tag"],
            valueType: "string",
            version: 1,
          }),
          groupMap: "savedGroupMap",
        }),
      }),
    );
    expect(auditMock).toHaveBeenCalledWith({
      details: `{"post":{"defaultValue":"defaultValue","valueType":"string","owner":"owner","description":"description","project":"project","dateCreated":"${response.body.feature.feature.dateCreated}","dateUpdated":"${response.body.feature.feature.dateUpdated}","organization":"org","id":"id","archived":true,"version":1,"environmentSettings":"createInterfaceEnvSettingsFromApiEnvSettings","prerequisites":[],"tags":["tag"],"jsonSchema":{"schemaType":"schema","schema":"","simple":{"type":"object","fields":[]},"date":"${response.body.feature.feature.jsonSchema.date}","enabled":false}},"context":{}}`,
      entity: { id: "id", object: "feature" },
      event: "feature.create",
    });
  });

  describe("requireProjectForFeatures enabled", () => {
    it("fails to create new features without a project", async () => {
      setReqContext({
        org: {
          ...org,
          settings: {
            requireProjectForFeatures: true,
          },
        },
        models: {
          safeRollout: {
            getAllPayloadSafeRollouts: jest.fn().mockResolvedValue(new Map()),
          },
        },
        permissions: {
          canPublishFeature: () => true,
          canCreateFeature: () => true,
        },
        getProjects: async () => [{ id: "project" }],
      });

      const feature = {
        defaultValue: "defaultValue",
        valueType: "string",
        owner: "owner",
        description: "description",
        project: "",
        id: "id",
        archived: true,
        tags: ["tag"],
      };

      const response = await request(app)
        .post("/api/v1/features")
        .send(feature);

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        message: "Must specify a project for new features",
      });
    });

    it("fails to update existing features if removing a project", async () => {
      setReqContext({
        org: {
          ...org,
          settings: {
            requireProjectForFeatures: true,
          },
        },
        models: {
          safeRollout: {
            getAllPayloadSafeRollouts: jest.fn().mockResolvedValue(new Map()),
          },
        },
        permissions: {
          canPublishFeature: () => true,
          canCreateFeature: () => true,
          canUpdateFeature: () => true,
        },
        getProjects: async () => [{ id: "project" }],
      });

      const existingFeature: FeatureInterface = {
        organization: org.id,
        defaultValue: "defaultValue",
        valueType: "string",
        owner: "owner",
        description: "description",
        project: "project",
        id: "myexistingfeature",
        archived: true,
        tags: ["tag"],
        dateCreated: new Date(),
        dateUpdated: new Date(),
        version: 1,
        environmentSettings: {},
        prerequisites: [],
      };

      getFeature.mockImplementation((ctx, id) => {
        if (id === existingFeature.id) {
          return Promise.resolve(existingFeature);
        }
        return Promise.resolve(null);
      });

      updateFeature.mockImplementation((ctx, feature, updates) => {
        if (feature.id === existingFeature.id) {
          return Promise.resolve({ ...existingFeature, ...updates });
        }
        return Promise.resolve(null);
      });

      const updates = {
        project: "",
      };

      const response = await request(app)
        .post(`/api/v1/features/${existingFeature.id}`)
        .send(updates);

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        message: "Must specify a project",
      });
    });

    it("allows updating existing features if originally not associated with a project", async () => {
      setReqContext({
        org: {
          ...org,
          settings: {
            requireProjectForFeatures: true,
          },
        },
        models: {
          safeRollout: {
            getAllPayloadSafeRollouts: jest.fn().mockResolvedValue(new Map()),
          },
        },
        permissions: {
          canPublishFeature: () => true,
          canCreateFeature: () => true,
          canUpdateFeature: () => true,
        },
        getProjects: async () => [{ id: "project" }],
      });

      const existingFeature: FeatureInterface = {
        organization: org.id,
        defaultValue: "defaultValue",
        valueType: "string",
        owner: "owner",
        description: "description",
        project: "",
        id: "myexistingfeature",
        archived: true,
        tags: ["tag"],
        dateCreated: new Date(),
        dateUpdated: new Date(),
        version: 1,
        environmentSettings: {},
        prerequisites: [],
      };

      getFeature.mockImplementation((ctx, id) => {
        if (id === existingFeature.id) {
          return Promise.resolve(existingFeature);
        }
        return Promise.resolve(null);
      });

      updateFeature.mockImplementation((ctx, feature, updates) => {
        if (feature.id === existingFeature.id) {
          return Promise.resolve({ ...existingFeature, ...updates });
        }
        return Promise.resolve(null);
      });

      const newDescription = "This is an updated description";
      const updates = {
        description: newDescription,
      };

      const response = await request(app)
        .post(`/api/v1/features/${existingFeature.id}`)
        .send(updates);

      expect(response.status).toBe(200);
      expect(response.body).toEqual(
        expect.objectContaining({
          feature: expect.objectContaining({
            experimentMap: {},
            feature: expect.objectContaining({
              archived: true,
              dateCreated: expect.any(String),
              dateUpdated: expect.any(String),
              defaultValue: "defaultValue",
              description: newDescription,
              environmentSettings: {},
              prerequisites: [],
              id: "myexistingfeature",
              organization: "org",
              owner: "owner",
              project: "", // Still empty
              tags: ["tag"],
              valueType: "string",
              version: 1,
            }),
            groupMap: "savedGroupMap",
          }),
        }),
      );
    });
  });

  describe("nextScheduledUpdate", () => {
    it("writes nextScheduledUpdate when scheduleRules are updated via API", async () => {
      setReqContext({
        org,
        models: {
          safeRollout: {
            getAllPayloadSafeRollouts: jest.fn().mockResolvedValue(new Map()),
          },
        },
        permissions: {
          canPublishFeature: () => true,
          canUpdateFeature: () => true,
          canBypassApprovalChecks: () => true,
        },
        hasPremiumFeature: () => true,
        getProjects: async () => [{ id: "project_1" }],
      });

      const existingFeature: FeatureInterface = {
        organization: org.id,
        defaultValue: "false",
        valueType: "boolean",
        owner: "owner",
        description: "description",
        project: "project_1",
        id: "myexistingfeature",
        archived: false,
        tags: [],
        dateCreated: new Date(),
        dateUpdated: new Date(),
        version: 10,
        environmentSettings: {
          production: {
            enabled: true,
            rules: [],
          },
        },
        prerequisites: [],
      };

      const startTs = "2026-02-20T08:00:00.000Z";
      const endTs = "2026-02-25T08:00:00.000Z";
      const nextScheduledUpdate = new Date(startTs);
      const updatedEnvironmentSettings = {
        production: {
          enabled: true,
          rules: [
            {
              id: "fr_test",
              type: "force",
              description: "scheduled force",
              condition: "",
              value: "true",
              enabled: true,
              savedGroups: [],
              scheduleRules: [
                {
                  enabled: true,
                  timestamp: startTs,
                },
                {
                  enabled: false,
                  timestamp: endTs,
                },
              ],
            },
          ],
        },
      };

      (getFeature as jest.Mock).mockResolvedValue(existingFeature);
      (
        updateInterfaceEnvSettingsFromApiEnvSettings as jest.Mock
      ).mockReturnValue(updatedEnvironmentSettings);
      (getNextScheduledUpdate as jest.Mock).mockReturnValue(
        nextScheduledUpdate,
      );
      (createRevision as jest.Mock).mockResolvedValue({ version: 11 });
      (updateFeature as jest.Mock).mockImplementation((ctx, feature, updates) =>
        Promise.resolve({ ...feature, ...updates }),
      );

      const response = await request(app)
        .post(`/api/v1/features/${existingFeature.id}`)
        .send({
          environments: {
            production: {
              enabled: true,
              rules: [
                {
                  id: "fr_test",
                  type: "force",
                  description: "scheduled force",
                  condition: "",
                  value: "true",
                  enabled: true,
                  scheduleRules: [
                    { enabled: true, timestamp: startTs },
                    { enabled: false, timestamp: endTs },
                  ],
                },
              ],
            },
          },
        });

      expect(response.status).toBe(200);
      expect(updateFeature).toHaveBeenCalledWith(
        expect.anything(),
        existingFeature,
        expect.objectContaining({
          environmentSettings: updatedEnvironmentSettings,
          nextScheduledUpdate,
        }),
      );
    });

    it("does not modify nextScheduledUpdate if there are no environment updates", async () => {
      setReqContext({
        org,
        models: {
          safeRollout: {
            getAllPayloadSafeRollouts: jest.fn().mockResolvedValue(new Map()),
          },
        },
        permissions: {
          canPublishFeature: () => true,
          canUpdateFeature: () => true,
        },
        getProjects: async () => [{ id: "project_1" }, { id: "project_2" }],
      });

      const existingFeature: FeatureInterface = {
        organization: org.id,
        defaultValue: "false",
        valueType: "boolean",
        owner: "owner",
        description: "description",
        project: "project_1",
        id: "myexistingfeature",
        archived: false,
        tags: [],
        dateCreated: new Date(),
        dateUpdated: new Date(),
        version: 10,
        environmentSettings: {
          production: {
            enabled: true,
            rules: [
              {
                id: "fr_schedule",
                type: "force",
                condition: "",
                value: "true",
                savedGroups: [],
                scheduleRules: [
                  {
                    enabled: true,
                    timestamp: "2026-02-20T08:00:00.000Z",
                  },
                ],
              },
            ],
          },
        },
        prerequisites: [],
      };

      const preservedNextScheduledUpdate = new Date("2026-02-20T08:00:00.000Z");

      (getFeature as jest.Mock).mockResolvedValue(existingFeature);
      (getNextScheduledUpdate as jest.Mock).mockImplementation((envSettings) =>
        envSettings ? preservedNextScheduledUpdate : null,
      );
      (updateFeature as jest.Mock).mockImplementation((ctx, feature, updates) =>
        Promise.resolve({ ...feature, ...updates }),
      );

      const response = await request(app)
        .post(`/api/v1/features/${existingFeature.id}`)
        .send({
          project: "project_2",
        });

      expect(response.status).toBe(200);
      expect(updateFeature).toHaveBeenCalledWith(
        expect.anything(),
        existingFeature,
        {
          project: "project_2",
        },
      );
    });
  });
});
