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
      models: {
        safeRollout: {
          getAllPayloadSafeRollouts: jest.fn().mockResolvedValue(new Map()),
        },
      },
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
      project: "",
      archived: false,
      dateCreated: new Date("2024-01-01").toISOString(),
      dateUpdated: new Date("2020-01-01").toISOString(),
      stale: true,
      reason: "no-rules",
      valueType: "boolean",
      environments: {
        production: { value: "false" },
        dev: { value: "false" },
      },
    });
    // feature-2 has a recent dateUpdated, so it's not stale
    // We can't use new Date() in the assertion as it changes, so we check it's recent
    expect(response.body.features[1].id).toBe("feature-2");
    expect(response.body.features[1].owner).toBe("");
    expect(response.body.features[1].project).toBe("");
    expect(response.body.features[1].archived).toBe(false);
    expect(response.body.features[1].dateCreated).toBe(
      new Date("2024-01-01").toISOString(),
    );
    expect(
      new Date(response.body.features[1].dateUpdated).getTime(),
    ).toBeGreaterThan(new Date("2024-01-01").getTime());
    expect(response.body.features[1].stale).toBe(false);
    expect(response.body.features[1].valueType).toBe("boolean");
    expect(response.body.features[1].environments).toEqual({
      production: { value: "false" },
      dev: { value: "false" },
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
        dateUpdated: new Date("2020-01-01"), // Older, should come first
        environmentSettings: {
          production: { enabled: true, rules: [] },
        },
      }),
      createFeature("feature-2", {
        dateUpdated: new Date("2021-01-01"), // Newer, should come second
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
    // Verify sorting by dateUpdated (oldest first)
    expect(response.body.features[0].id).toBe("feature-1");
    expect(response.body.features[0].dateUpdated).toBe(
      new Date("2020-01-01").toISOString(),
    );
    expect(response.body.features[1].id).toBe("feature-2");
    expect(response.body.features[1].dateUpdated).toBe(
      new Date("2021-01-01").toISOString(),
    );
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
      project: "",
      archived: false,
      dateCreated: new Date("2024-01-01").toISOString(),
      dateUpdated: new Date("2020-01-01").toISOString(),
      stale: true,
      reason: "rules-one-sided",
      valueType: "boolean",
      environments: {
        production: { value: "true" }, // Value from the rollout rule, not the feature's default
        dev: { value: "false" }, // No rules in dev, so uses default
      },
    });
    expect(response.body.total).toBe(1);
  });

  it("handles features with force rules (rules-one-sided)", async () => {
    const features = [
      createFeature("feature-force", {
        dateUpdated: new Date("2020-01-01"),
        defaultValue: "false", // Default is false
        environmentSettings: {
          production: {
            enabled: true,
            rules: [
              {
                type: "force",
                id: "force-rule-1",
                enabled: true,
                description: "",
                condition: "", // No condition, applies to everyone
                value: "true", // Force rule sets it to true
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
      .send({ featureIds: ["feature-force"] })
      .set("Authorization", "Bearer foo");

    expect(response.status).toBe(200);
    expect(response.body.features[0]).toEqual({
      id: "feature-force",
      owner: "",
      project: "",
      archived: false,
      dateCreated: new Date("2024-01-01").toISOString(),
      dateUpdated: new Date("2020-01-01").toISOString(),
      stale: true,
      reason: "rules-one-sided",
      valueType: "boolean",
      environments: {
        production: { value: "true" }, // Value from the force rule, not the feature's default
        dev: { value: "false" }, // No rules in dev, so uses default
      },
    });
  });

  it("returns different values for different environments", async () => {
    const features = [
      createFeature("feature-env-specific", {
        dateUpdated: new Date("2020-01-01"),
        defaultValue: "false",
        environmentSettings: {
          production: {
            enabled: true,
            rules: [
              {
                type: "force",
                id: "force-prod",
                enabled: true,
                description: "",
                condition: "",
                value: "true", // Production has force rule to true
              },
            ],
          },
          dev: {
            enabled: true,
            rules: [
              {
                type: "force",
                id: "force-dev",
                enabled: true,
                description: "",
                condition: "",
                value: "false", // Dev has force rule to false
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
      .send({ featureIds: ["feature-env-specific"] })
      .set("Authorization", "Bearer foo");

    expect(response.status).toBe(200);
    expect(response.body.features[0]).toEqual({
      id: "feature-env-specific",
      owner: "",
      project: "",
      archived: false,
      dateCreated: new Date("2024-01-01").toISOString(),
      dateUpdated: new Date("2020-01-01").toISOString(),
      stale: true,
      reason: "rules-one-sided",
      valueType: "boolean",
      environments: {
        production: { value: "true" }, // Production value from force rule
        dev: { value: "false" }, // Dev value from force rule
      },
    });
  });

  it("returns empty array for non-existent feature IDs", async () => {
    const features = [
      createFeature("feature-1", {
        dateUpdated: new Date("2020-01-01"),
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
      models: {
        safeRollout: {
          getAllPayloadSafeRollouts: jest.fn().mockResolvedValue(new Map()),
        },
      },
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
      project: "",
      archived: false,
      dateCreated: new Date("2024-01-01").toISOString(),
      dateUpdated: new Date("2020-01-01").toISOString(),
      stale: false,
      valueType: "boolean",
      environments: {
        production: { value: "false" },
        dev: { value: "false" },
      },
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
      project: "",
      archived: false,
      dateCreated: new Date("2024-01-01").toISOString(),
      dateUpdated: new Date("2020-01-01").toISOString(),
      stale: false,
      valueType: "boolean",
      environments: {
        production: { value: "false" },
        dev: { value: "false" },
      },
    });
  });

  it("supports pagination with limit and offset", async () => {
    // Use different dates to verify sorting by dateUpdated (oldest first)
    const features = [
      createFeature("feature-a", { dateUpdated: new Date("2020-01-01") }), // Oldest
      createFeature("feature-b", { dateUpdated: new Date("2020-01-02") }),
      createFeature("feature-c", { dateUpdated: new Date("2020-01-03") }),
      createFeature("feature-d", { dateUpdated: new Date("2020-01-04") }), // Newest
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

  it("handles empty featureIds array", async () => {
    const features = [
      createFeature("feature-1", {
        dateUpdated: new Date("2020-01-01"),
        environmentSettings: {
          production: { enabled: true, rules: [] },
        },
      }),
    ];

    (getAllFeatures as jest.Mock).mockResolvedValue(features);
    (getAllPayloadExperiments as jest.Mock).mockResolvedValue(new Map());

    // Empty array should be treated the same as undefined (return all features)
    const response = await request(app)
      .post("/api/v1/stale-features")
      .send({ featureIds: [] })
      .set("Authorization", "Bearer foo");

    expect(response.status).toBe(200);
    expect(response.body.features).toHaveLength(1);
    expect(response.body.features[0].id).toBe("feature-1");
  });

  it("handles stopped experiments (experiment-ref rules)", async () => {
    const features = [
      createFeature("feature-with-stopped-exp", {
        dateUpdated: new Date("2020-01-01"),
        linkedExperiments: [],
        environmentSettings: {
          production: {
            enabled: true,
            rules: [
              {
                type: "experiment-ref",
                id: "exp-ref-1",
                enabled: true,
                description: "",
                condition: "",
                experimentId: "exp_123",
                variations: [
                  { value: "false", variationId: "var_control" },
                  { value: "true", variationId: "var_treatment" },
                ],
              },
            ],
          },
        },
      }),
    ];

    const experiments = [
      {
        id: "exp_123",
        status: "stopped",
        releasedVariationId: "var_treatment", // Winning variation
        archived: false,
        phases: [{ coverage: 1 }], // Required for includeExperimentInPayload
        hasVisualChangesets: false,
        hasURLRedirects: false,
      },
    ];

    (getAllFeatures as jest.Mock).mockResolvedValue(features);
    (getAllPayloadExperiments as jest.Mock).mockResolvedValue(
      new Map(experiments.map((e) => [e.id, e])),
    );

    const response = await request(app)
      .post("/api/v1/stale-features")
      .send({ featureIds: ["feature-with-stopped-exp"] })
      .set("Authorization", "Bearer foo");

    expect(response.status).toBe(200);
    expect(response.body.features[0]).toEqual({
      id: "feature-with-stopped-exp",
      owner: "",
      project: "",
      archived: false,
      dateCreated: new Date("2024-01-01").toISOString(),
      dateUpdated: new Date("2020-01-01").toISOString(),
      stale: true,
      reason: "rules-one-sided",
      valueType: "boolean",
      environments: {
        production: { value: "true" }, // Value from winning variation
        dev: { value: "false" }, // No rules in dev, uses default
      },
    });
  });

  it("handles disabled environments", async () => {
    const features = [
      createFeature("feature-disabled-env", {
        dateUpdated: new Date("2020-01-01"),
        environmentSettings: {
          production: {
            enabled: false, // Disabled environment
            rules: [],
          },
          dev: {
            enabled: true,
            rules: [
              {
                type: "force",
                id: "force-dev",
                enabled: true,
                description: "",
                condition: "",
                value: "true",
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
      .send({ featureIds: ["feature-disabled-env"] })
      .set("Authorization", "Bearer foo");

    expect(response.status).toBe(200);
    expect(response.body.features[0].environments).toEqual({
      production: { value: "false" }, // Uses default when environment is disabled
      dev: { value: "true" }, // Uses rule value when enabled
    });
  });
});
