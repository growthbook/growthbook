import request from "supertest";
import { FeatureInterface } from "back-end/types/feature";
import { getAllFeatures } from "back-end/src/models/FeatureModel";
import { getAllPayloadExperiments } from "back-end/src/models/ExperimentModel";
import { setupApp } from "./api.setup";

jest.mock("back-end/src/models/FeatureModel", () => ({
  getAllFeatures: jest.fn(),
}));

jest.mock("back-end/src/models/ExperimentModel", () => ({
  getAllPayloadExperiments: jest.fn(),
}));

describe("stale-features API", () => {
  const { app, setReqContext } = setupApp();

  afterEach(() => {
    jest.clearAllMocks();
  });

  const org = {
    id: "org_1",
    settings: {
      environments: [
        { id: "production", description: "Production" },
        { id: "dev", description: "Development" },
      ],
    },
  };

  const createFeature = (
    id: string,
    overrides: Partial<FeatureInterface> = {},
  ): FeatureInterface => ({
    id,
    organization: "org_1",
    archived: false,
    description: "",
    owner: "",
    project: "",
    dateCreated: new Date("2024-01-01"),
    dateUpdated: new Date("2024-01-01"),
    valueType: "boolean",
    defaultValue: "false",
    environmentSettings: {
      production: {
        enabled: true,
        rules: [],
      },
    },
    tags: [],
    version: 1,
    ...overrides,
  });

  beforeEach(() => {
    setReqContext({
      org,
      organization: org,
      permissions: {
        canReadSingleProjectResource: () => true,
      },
    });
  });

  it("returns stale status for specific feature IDs", async () => {
    const features = [
      createFeature("feature-1", {
        dateUpdated: new Date("2020-01-01"), // Old date, stale
        environmentSettings: {
          production: { enabled: true, rules: [] },
        },
      }),
      createFeature("feature-2", {
        dateUpdated: new Date(), // Recent date, not stale
        environmentSettings: {
          production: { enabled: true, rules: [] },
        },
      }),
      createFeature("feature-3", {
        dateUpdated: new Date("2020-01-01"), // Old date
        environmentSettings: {
          production: { enabled: true, rules: [] },
        },
      }),
    ];

    (getAllFeatures as jest.Mock).mockResolvedValue(features);
    (getAllPayloadExperiments as jest.Mock).mockResolvedValue(new Map());

    const response = await request(app)
      .post("/api/v1/stale-features")
      .send({ featureIds: ["feature-1", "feature-2"] })
      .set("Authorization", "Bearer foo");

    expect(response.status).toBe(200);
    expect(response.body.features).toHaveLength(2);
    expect(response.body.features[0]).toEqual({
      id: "feature-1",
      owner: "",
      dateCreated: new Date("2024-01-01").toISOString(),
      stale: true,
      reason: "no-rules",
    });
    expect(response.body.features[1]).toEqual({
      id: "feature-2",
      owner: "",
      dateCreated: new Date("2024-01-01").toISOString(),
      stale: false,
    });
    // Check pagination fields
    expect(response.body).toMatchObject({
      limit: 10,
      offset: 0,
      count: 2,
      total: 2,
      hasMore: false,
      nextOffset: null,
    });
  });

  it("returns stale status for all features when no IDs provided", async () => {
    const features = [
      createFeature("feature-1", {
        dateUpdated: new Date("2020-01-01"),
        environmentSettings: {
          production: { enabled: true, rules: [] },
        },
      }),
      createFeature("feature-2", {
        dateUpdated: new Date(),
        environmentSettings: {
          production: { enabled: true, rules: [] },
        },
      }),
    ];

    (getAllFeatures as jest.Mock).mockResolvedValue(features);
    (getAllPayloadExperiments as jest.Mock).mockResolvedValue(new Map());

    const response = await request(app)
      .post("/api/v1/stale-features")
      .send({})
      .set("Authorization", "Bearer foo");

    expect(response.status).toBe(200);
    expect(response.body.features).toHaveLength(2);
    expect(response.body.features[0].id).toBe("feature-1");
    expect(response.body.features[1].id).toBe("feature-2");
    expect(response.body.total).toBe(2);
  });

  it("filters by project when projectId query param provided", async () => {
    const features = [
      createFeature("feature-1", {
        project: "proj_123",
        dateUpdated: new Date("2020-01-01"),
        environmentSettings: {
          production: { enabled: true, rules: [] },
        },
      }),
    ];

    (getAllFeatures as jest.Mock).mockResolvedValue(features);
    (getAllPayloadExperiments as jest.Mock).mockResolvedValue(new Map());

    const response = await request(app)
      .post("/api/v1/stale-features?projectId=proj_123")
      .send({})
      .set("Authorization", "Bearer foo");

    expect(response.status).toBe(200);
    expect(getAllFeatures).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        projects: ["proj_123"],
        includeArchived: false,
      }),
    );
    expect(getAllPayloadExperiments).toHaveBeenCalledWith(expect.anything(), [
      "proj_123",
    ]);
  });

  it("handles features with rules-one-sided reason", async () => {
    const features = [
      createFeature("feature-1", {
        dateUpdated: new Date("2020-01-01"),
        environmentSettings: {
          production: {
            enabled: true,
            rules: [
              {
                type: "rollout",
                id: "rule-1",
                enabled: true,
                description: "",
                condition: "",
                value: "true",
                coverage: 1,
                hashAttribute: "id",
              },
            ],
          },
        },
      }),
    ];

    (getAllFeatures as jest.Mock).mockResolvedValue(features);
    (getAllPayloadExperiments as jest.Mock).mockResolvedValue(new Map());

    const response = await request(app)
      .post("/api/v1/stale-features")
      .send({ featureIds: ["feature-1"] })
      .set("Authorization", "Bearer foo");

    expect(response.status).toBe(200);
    expect(response.body.features[0]).toEqual({
      id: "feature-1",
      owner: "",
      dateCreated: new Date("2024-01-01").toISOString(),
      stale: true,
      reason: "rules-one-sided",
    });
    expect(response.body.total).toBe(1);
  });

  it("returns empty array for non-existent feature IDs", async () => {
    const features = [
      createFeature("feature-1", {
        dateUpdated: new Date(),
      }),
    ];

    (getAllFeatures as jest.Mock).mockResolvedValue(features);
    (getAllPayloadExperiments as jest.Mock).mockResolvedValue(new Map());

    const response = await request(app)
      .post("/api/v1/stale-features")
      .send({ featureIds: ["non-existent-1", "non-existent-2"] })
      .set("Authorization", "Bearer foo");

    expect(response.status).toBe(200);
    expect(response.body.features).toHaveLength(0);
    expect(response.body.total).toBe(0);
  });

  it("respects permissions and only returns features user can read", async () => {
    const features = [
      createFeature("feature-1", { project: "proj_allowed" }),
      createFeature("feature-2", { project: "proj_denied" }),
    ];

    setReqContext({
      org,
      organization: org,
      permissions: {
        canReadSingleProjectResource: (project?: string) =>
          project !== "proj_denied",
      },
    });

    (getAllFeatures as jest.Mock).mockImplementation((context, _options) => {
      return features.filter((f) =>
        context.permissions.canReadSingleProjectResource(f.project),
      );
    });
    (getAllPayloadExperiments as jest.Mock).mockResolvedValue(new Map());

    const response = await request(app)
      .post("/api/v1/stale-features")
      .send({})
      .set("Authorization", "Bearer foo");

    expect(response.status).toBe(200);
    expect(response.body.features).toHaveLength(1);
    expect(response.body.features[0].id).toBe("feature-1");
  });

  it("handles features with neverStale flag", async () => {
    const features = [
      createFeature("feature-1", {
        dateUpdated: new Date("2020-01-01"), // Old date
        neverStale: true, // But marked as neverStale
        environmentSettings: {
          production: { enabled: true, rules: [] },
        },
      }),
    ];

    (getAllFeatures as jest.Mock).mockResolvedValue(features);
    (getAllPayloadExperiments as jest.Mock).mockResolvedValue(new Map());

    const response = await request(app)
      .post("/api/v1/stale-features")
      .send({ featureIds: ["feature-1"] })
      .set("Authorization", "Bearer foo");

    expect(response.status).toBe(200);
    expect(response.body.features[0]).toEqual({
      id: "feature-1",
      owner: "",
      dateCreated: new Date("2024-01-01").toISOString(),
      stale: false,
    });
  });

  it("handles features with draft revisions", async () => {
    const features = [
      createFeature("feature-1", {
        dateUpdated: new Date("2020-01-01"),
        hasDrafts: true,
        environmentSettings: {
          production: { enabled: true, rules: [] },
        },
      }),
    ];

    (getAllFeatures as jest.Mock).mockResolvedValue(features);
    (getAllPayloadExperiments as jest.Mock).mockResolvedValue(new Map());

    const response = await request(app)
      .post("/api/v1/stale-features")
      .send({ featureIds: ["feature-1"] })
      .set("Authorization", "Bearer foo");

    expect(response.status).toBe(200);
    expect(response.body.features[0]).toEqual({
      id: "feature-1",
      owner: "",
      dateCreated: new Date("2024-01-01").toISOString(),
      stale: false,
    });
  });

  it("supports pagination with limit and offset", async () => {
    const features = [
      createFeature("feature-a", { dateUpdated: new Date("2020-01-01") }),
      createFeature("feature-b", { dateUpdated: new Date("2020-01-01") }),
      createFeature("feature-c", { dateUpdated: new Date("2020-01-01") }),
      createFeature("feature-d", { dateUpdated: new Date("2020-01-01") }),
    ];

    (getAllFeatures as jest.Mock).mockResolvedValue(features);
    (getAllPayloadExperiments as jest.Mock).mockResolvedValue(new Map());

    // First page (limit=2, offset=0)
    const response1 = await request(app)
      .post("/api/v1/stale-features?limit=2&offset=0")
      .send({})
      .set("Authorization", "Bearer foo");

    expect(response1.status).toBe(200);
    expect(response1.body.features).toHaveLength(2);
    expect(response1.body.features[0].id).toBe("feature-a");
    expect(response1.body.features[1].id).toBe("feature-b");
    expect(response1.body).toMatchObject({
      limit: 2,
      offset: 0,
      count: 2,
      total: 4,
      hasMore: true,
      nextOffset: 2,
    });

    // Second page (limit=2, offset=2)
    const response2 = await request(app)
      .post("/api/v1/stale-features?limit=2&offset=2")
      .send({})
      .set("Authorization", "Bearer foo");

    expect(response2.status).toBe(200);
    expect(response2.body.features).toHaveLength(2);
    expect(response2.body.features[0].id).toBe("feature-c");
    expect(response2.body.features[1].id).toBe("feature-d");
    expect(response2.body).toMatchObject({
      limit: 2,
      offset: 2,
      count: 2,
      total: 4,
      hasMore: false,
      nextOffset: null,
    });
  });
});
