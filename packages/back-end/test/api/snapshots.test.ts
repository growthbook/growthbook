import request from "supertest";
import { createFeature, getFeature } from "../../src/models/FeatureModel";
import { addTags } from "../../src/models/TagModel";
import {
  getSavedGroupMap,
  getApiFeatureObj,
  createInterfaceEnvSettingsFromApiEnvSettings,
} from "../../src/services/features";
import { setupApp } from "./api.setup";
import { getExperimentById } from "../../src/models/ExperimentModel";
import { findSnapshotById } from "../../src/models/ExperimentSnapshotModel";

jest.mock("../../src/models/ExperimentModel", () => ({
  getExperimentById: jest.fn(),
}));

jest.mock("../../src/models/ExperimentSnapshotModel", () => ({
  findSnapshotById: jest.fn(),
}));

jest.mock("../../src/services/features", () => ({
  getApiFeatureObj: jest.fn(),
  getSavedGroupMap: jest.fn(),
  addIdsToRules: jest.fn(),
  createInterfaceEnvSettingsFromApiEnvSettings: jest.fn(),
}));

describe("snapshots API", () => {
  const { app, auditMock, setReqContext } = setupApp();

  afterEach(() => {
    jest.clearAllMocks();
  });

  const org = { id: "org" };

  it("can get a snapshot", async () => {
    setReqContext({
      org,
      permissions: {
        canReadSingleProjectResource: () => true,
      },
    });

    const response = await request(app)
      .get("/api/v1/snapshots/snp_123")
      .set("Authorization", "Bearer foo");
    console.log(response);

    expect(response.status).toBe(200);
    // expect(getApiFeatureObj).toHaveBeenCalled();
    // expect(addTags).toHaveBeenCalledWith("org", ["tag"]);
    // expect(response.body).toEqual(
    //   expect.objectContaining({
    //     feature: expect.objectContaining({
    //       experimentMap: {},
    //       feature: expect.objectContaining({
    //         archived: true,
    //         dateCreated: expect.any(String),
    //         dateUpdated: expect.any(String),
    //         defaultValue: "defaultValue",
    //         description: "description",
    //         environmentSettings: "createInterfaceEnvSettingsFromApiEnvSettings",
    //         id: "id",
    //         jsonSchema: expect.objectContaining({
    //           date: expect.any(String),
    //           enabled: false,
    //           schema: "",
    //           schemaType: "schema",
    //           simple: { fields: [], type: "object" },
    //         }),
    //         organization: "org",
    //         owner: "owner",
    //         project: "project",
    //         tags: ["tag"],
    //         valueType: "string",
    //         version: 1,
    //       }),
    //       groupMap: "savedGroupMap",
    //     }),
    //   })
    // );
    // expect(auditMock).toHaveBeenCalledWith({
    //   details: `{"post":{"defaultValue":"defaultValue","valueType":"string","owner":"owner","description":"description","project":"project","dateCreated":"${response.body.feature.feature.dateCreated}","dateUpdated":"${response.body.feature.feature.dateUpdated}","organization":"org","id":"id","archived":true,"version":1,"environmentSettings":"createInterfaceEnvSettingsFromApiEnvSettings","tags":["tag"],"jsonSchema":{"schemaType":"schema","schema":"","simple":{"type":"object","fields":[]},"date":"${response.body.feature.feature.jsonSchema.date}","enabled":false}},"context":{}}`,
    //   entity: { id: "id", object: "feature" },
    //   event: "feature.create",
    // });
  });
});
