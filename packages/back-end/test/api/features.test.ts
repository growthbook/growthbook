import request from "supertest";
import { createFeature, getFeature } from "../../src/models/FeatureModel";
import { addTags } from "../../src/models/TagModel";
import {
  getSavedGroupMap,
  getApiFeatureObj,
  createInterfaceEnvSettingsFromApiEnvSettings,
} from "../../src/services/features";
import { setupApp } from "./api.setup";

jest.mock("../../src/models/FeatureModel", () => ({
  getFeature: jest.fn(),
  createFeature: jest.fn(),
}));

jest.mock("../../src/models/TagModel", () => ({
  addTags: jest.fn(),
}));

jest.mock("../../src/services/features", () => ({
  getApiFeatureObj: jest.fn(),
  getSavedGroupMap: jest.fn(),
  addIdsToRules: jest.fn(),
  createInterfaceEnvSettingsFromApiEnvSettings: jest.fn(),
}));

describe("features API", () => {
  const { app, setReqContext } = setupApp();

  afterEach(() => {
    jest.clearAllMocks();
  });

  const org = { id: "org", environments: [{ id: "production" }] };

  it("can create new features", async () => {
    setReqContext({
      org,
      permissions: {
        canPublishFeature: () => true,
        canCreateFeature: () => true,
      },
    });

    createFeature.mockImplementation((v) => v);
    getFeature.mockReturnValue(undefined);
    addTags.mockReturnValue(undefined);
    createInterfaceEnvSettingsFromApiEnvSettings.mockReturnValue(
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
  });
});
