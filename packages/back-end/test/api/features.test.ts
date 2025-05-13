import request from "supertest";
import { createFeature, getFeature } from "back-end/src/models/FeatureModel";
import { addTags } from "back-end/src/models/TagModel";
import {
  getSavedGroupMap,
  getApiFeatureObj,
  createInterfaceEnvSettingsFromApiEnvSettings,
} from "back-end/src/services/features";
import { setupApp } from "./api.setup";

jest.mock("back-end/src/models/FeatureModel", () => ({
  getFeature: jest.fn(),
  createFeature: jest.fn(),
}));

jest.mock("back-end/src/models/TagModel", () => ({
  addTags: jest.fn(),
}));

jest.mock("back-end/src/services/features", () => ({
  getApiFeatureObj: jest.fn(),
  getSavedGroupMap: jest.fn(),
  addIdsToRules: jest.fn(),
  createInterfaceEnvSettingsFromApiEnvSettings: jest.fn(),
}));

describe("features API", () => {
  const { app, auditMock, setReqContext } = setupApp();

  afterEach(() => {
    jest.clearAllMocks();
  });

  const org = { id: "org", environments: [{ id: "production" }] };

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
      "createInterfaceEnvSettingsFromApiEnvSettings"
    );
    getSavedGroupMap.mockReturnValue("savedGroupMap");
    getApiFeatureObj.mockImplementation((v) => v);

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
    console.log(response);
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
});
