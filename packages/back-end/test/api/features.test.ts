import { describe, it, expect, vi, afterEach } from "vitest";
import request from "supertest";
import { FeatureInterface } from "back-end/types/feature";
import {
  createFeature,
  getFeature,
  updateFeature,
} from "back-end/src/models/FeatureModel";
import { addTags } from "back-end/src/models/TagModel";
import {
  getSavedGroupMap,
  getApiFeatureObj,
  createInterfaceEnvSettingsFromApiEnvSettings,
} from "back-end/src/services/features";
import { setupApp } from "./api.setup";

vi.mock("back-end/src/models/FeatureModel", () => ({
  getFeature: vi.fn(),
  createFeature: vi.fn(),
  updateFeature: vi.fn(),
}));

vi.mock("back-end/src/models/TagModel", () => ({
  addTags: vi.fn(),
  addTagsDiff: vi.fn(),
}));

vi.mock("back-end/src/services/features", () => ({
  getApiFeatureObj: vi.fn(),
  getSavedGroupMap: vi.fn(),
  addIdsToRules: vi.fn(),
  createInterfaceEnvSettingsFromApiEnvSettings: vi.fn(),
}));

const mockGetFeature = vi.mocked(getFeature);
const mockCreateFeature = vi.mocked(createFeature);
const mockAddTags = vi.mocked(addTags);
const mockGetSavedGroupMap = vi.mocked(getSavedGroupMap);
const mockGetApiFeatureObj = vi.mocked(getApiFeatureObj);
const mockCreateInterfaceEnvSettingsFromApiEnvSettings = vi.mocked(
  createInterfaceEnvSettingsFromApiEnvSettings
);

describe("features API", () => {
  const { app, auditMock, setReqContext } = setupApp();

  afterEach(() => {
    vi.clearAllMocks();
  });

  const org = { id: "org", settings: { environments: [{ id: "production" }] } };

  it("can create new features", async () => {
    setReqContext({
      org,
      models: {
        safeRollout: {
          getAllPayloadSafeRollouts: vi.fn().mockResolvedValue(new Map()),
        },
      },
      permissions: {
        canPublishFeature: () => true,
        canCreateFeature: () => true,
      },
      getProjects: async () => [{ id: "project" }],
    });

    mockCreateFeature.mockImplementation((v) => v);
    mockGetFeature.mockReturnValue(undefined);
    mockAddTags.mockReturnValue(undefined);
    mockCreateInterfaceEnvSettingsFromApiEnvSettings.mockReturnValue(
      "createInterfaceEnvSettingsFromApiEnvSettings"
    );
    mockGetSavedGroupMap.mockResolvedValue("savedGroupMap");
    mockGetApiFeatureObj.mockImplementation((v) => v);

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
      })
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
            getAllPayloadSafeRollouts: vi.fn().mockResolvedValue(new Map()),
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
            getAllPayloadSafeRollouts: vi.fn().mockResolvedValue(new Map()),
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
            getAllPayloadSafeRollouts: vi.fn().mockResolvedValue(new Map()),
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
        })
      );
    });
  });
});
