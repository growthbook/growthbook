import { ReqContext } from "shared/types/organization";
import { getFeatureDefinitionsWithCache } from "back-end/src/controllers/features";
import { getAllFeatures } from "back-end/src/models/FeatureModel";
import {
  getAllPayloadExperiments,
  getAllVisualExperiments,
  getAllURLRedirectExperiments,
} from "back-end/src/models/ExperimentModel";
jest.mock("back-end/src/models/FeatureModel", () => ({
  getAllFeatures: jest.fn(),
}));

jest.mock("back-end/src/models/ExperimentModel", () => ({
  getAllPayloadExperiments: jest.fn(),
  getAllVisualExperiments: jest.fn(),
  getAllURLRedirectExperiments: jest.fn(),
}));

jest.mock("back-end/src/models/SdkConnectionCacheModel", () => ({
  getSDKPayloadCacheLocation: jest.fn().mockReturnValue("none"),
  SdkConnectionCacheModel: jest.fn(),
}));

jest.mock("shared/util", () => ({
  ...jest.requireActual("shared/util"),
  getSavedGroupsValuesFromInterfaces: jest.fn().mockReturnValue({}),
}));

jest.mock("back-end/src/init/config", () => ({
  usingFileConfig: false,
  getConfigMetrics: jest.fn().mockReturnValue([]),
  getConfigDimensions: jest.fn().mockReturnValue([]),
  getConfigSegments: jest.fn().mockReturnValue([]),
  getConfigOrganizationSettings: jest.fn().mockReturnValue({}),
}));

jest.mock("back-end/src/services/python", () => ({
  statsServerPool: {
    acquire: jest.fn(),
    release: jest.fn(),
  },
}));

describe("getFeatureDefinitionsWithCache - Holdout Tests", () => {
  const mockContext = {
    org: {
      id: "test-org-id",
      name: "Test Organization",
      settings: {
        environments: [
          { id: "production", projects: ["project-1", "project-2"] },
        ],
      },
    },
    models: {
      safeRollout: {
        getAllPayloadSafeRollouts: jest
          .fn()
          .mockResolvedValue(new Map()) as jest.Mock,
      },
      holdout: {
        getAllPayloadHoldouts: jest
          .fn()
          .mockResolvedValue(new Map()) as jest.Mock,
      },
      savedGroups: {
        getAll: jest.fn().mockResolvedValue([]),
        getByIds: jest.fn().mockResolvedValue([]),
      },
    },
    userId: "test-user",
    email: "test@example.com",
    userName: "Test User",
    initModels: jest.fn(),
  } as unknown as ReqContext;

  beforeEach(() => {
    jest.clearAllMocks();

    (getAllPayloadExperiments as jest.Mock).mockResolvedValue(new Map());
    (getAllVisualExperiments as jest.Mock).mockResolvedValue([]);
    (getAllURLRedirectExperiments as jest.Mock).mockResolvedValue([]);
  });

  it("should include holdout and holdout rule when holdout has the requested project", async () => {
    // Mock features
    (getAllFeatures as jest.Mock).mockResolvedValue([
      {
        id: "feature-with-holdout",
        valueType: "string",
        defaultValue: "default_value",
        environmentSettings: {
          production: {
            enabled: true,
            rules: [
              {
                id: "sample_rule",
                value: "sample_value",
                type: "force",
                enabled: true,
              },
            ],
          },
        },
        project: "project-2",
        holdout: {
          id: "hld_test_holdout",
          value: "default_value",
        },
      },
    ]);

    // Mock holdouts
    (
      mockContext.models.holdout.getAllPayloadHoldouts as jest.Mock
    ).mockResolvedValue(
      new Map([
        [
          "hld_test_holdout",
          {
            holdout: {
              id: "hld_test_holdout",
              name: "Test Holdout",
              projects: ["project-2"], // Same project as feature
              environment: "production",
              environmentSettings: {
                production: {
                  enabled: true,
                },
              },
            },
            holdoutExperiment: /* renamed from `experiment` on main */ {
              id: "exp_holdout",
              name: "Holdout Experiment",
              hashAttribute: "user_id",
              trackingKey: "holdout-tracking-key",
              phases: [
                {
                  dateStarted: new Date("2023-01-01"),
                  dateEnded: null,
                  coverage: 0.1,
                  seed: "holdout-seed",
                  variationWeights: [0.5, 0.5],
                },
              ],
            },
          },
        ],
      ]),
    );

    const result = await getFeatureDefinitionsWithCache({
      context: mockContext,
      params: {
        key: "test-cache-key",
        organization: mockContext.org.id,
        environment: "production",
        projects: ["project-2"],
        encryptPayload: false,
        encryptionKey: "",
        languages: ["javascript"],
        sdkVersion: "1.0.0",
      },
    });

    // Verify holdout feature def is present and its rule is populated from experiment data
    // (generateHoldoutsPayload derives coverage/hashAttribute/key/seed from experiment.phases[0] and experiment fields)
    expect(result.features["$holdout:hld_test_holdout"]).toMatchObject({
      defaultValue: "genpop",
      rules: [
        expect.objectContaining({
          coverage: 0.1,
          hashAttribute: "user_id",
          key: "holdout-tracking-key",
          seed: "holdout-seed",
          hashVersion: 2,
          variations: ["holdoutcontrol", "holdouttreatment"],
          weights: [0.5, 0.5],
        }),
      ],
    });

    // Verify feature has 2 rules: holdout gate rule first, then original force rule
    expect(result.features["feature-with-holdout"].rules).toHaveLength(2);
    expect(result.features["feature-with-holdout"].rules?.[0]).toMatchObject({
      parentConditions: [
        {
          id: "$holdout:hld_test_holdout",
          condition: { value: "holdoutcontrol" },
        },
      ],
      force: "default_value",
    });
    expect(result.features["feature-with-holdout"].rules?.[1]).toMatchObject({
      force: "sample_value",
    });
  });

  it("should NOT include holdout and holdout rule when holdout doesn't have the requested project", async () => {
    // Mock features
    (getAllFeatures as jest.Mock).mockResolvedValue([
      {
        id: "feature-with-holdout",
        valueType: "string",
        defaultValue: "default_value",
        environmentSettings: {
          production: {
            enabled: true,
            rules: [
              {
                id: "sample_rule",
                value: "sample_value",
                type: "force",
                enabled: true,
              },
            ],
          },
        },
        project: "project-1",
        holdout: {
          id: "hld_test_holdout",
          value: "default_value",
        },
      },
    ]);

    // Mock holdouts
    (
      mockContext.models.holdout.getAllPayloadHoldouts as jest.Mock
    ).mockResolvedValue(
      new Map([
        [
          "hld_test_holdout",
          {
            holdout: {
              id: "hld_test_holdout",
              name: "Test Holdout",
              projects: ["project-2"], // Different project from feature
              environment: "production",
              environmentSettings: {
                production: {
                  enabled: true,
                },
              },
            },
            holdoutExperiment: /* renamed from `experiment` on main */ {
              id: "exp_holdout",
              name: "Holdout Experiment",
              hashAttribute: "user_id",
              trackingKey: "holdout-tracking-key",
              phases: [
                {
                  dateStarted: new Date("2023-01-01"),
                  dateEnded: null,
                  coverage: 0.1,
                  seed: "holdout-seed",
                  variationWeights: [0.5, 0.5],
                },
              ],
            },
          },
        ],
      ]),
    );

    const result = await getFeatureDefinitionsWithCache({
      context: mockContext,
      params: {
        key: "test-cache-key-2",
        organization: mockContext.org.id,
        environment: "production",
        projects: ["project-1"],
        encryptPayload: false,
        encryptionKey: "",
        languages: ["javascript"],
        sdkVersion: "1.0.0",
      },
    });

    // Verify holdout is NOT included
    expect(result.features).not.toHaveProperty("$holdout:hld_test_holdout");
    // Verify feature does not have holdout rule
    expect(result.features["feature-with-holdout"].rules).toHaveLength(1);
  });

  it("should include holdout and holdout rule when requested project is in holdout projects array", async () => {
    // Mock features
    (getAllFeatures as jest.Mock).mockResolvedValue([
      {
        id: "feature-with-holdout",
        valueType: "string",
        defaultValue: "default_value",
        environmentSettings: {
          production: {
            enabled: true,
            rules: [
              {
                id: "sample_rule",
                value: "sample_value",
                type: "force",
                enabled: true,
              },
            ],
          },
        },
        project: "project-2",
        holdout: {
          id: "hld_test_holdout",
          value: "default_value",
        },
      },
    ]);

    // Mock holdouts
    (
      mockContext.models.holdout.getAllPayloadHoldouts as jest.Mock
    ).mockResolvedValue(
      new Map([
        [
          "hld_test_holdout",
          {
            holdout: {
              id: "hld_test_holdout",
              name: "Test Holdout",
              projects: ["project-2", "project-3"],
              environment: "production",
              environmentSettings: {
                production: {
                  enabled: true,
                },
              },
            },
            holdoutExperiment: /* renamed from `experiment` on main */ {
              id: "exp_holdout",
              name: "Holdout Experiment",
              hashAttribute: "user_id",
              trackingKey: "holdout-tracking-key",
              phases: [
                {
                  dateStarted: new Date("2023-01-01"),
                  dateEnded: null,
                  coverage: 0.1,
                  seed: "holdout-seed",
                  variationWeights: [0.5, 0.5],
                },
              ],
            },
          },
        ],
      ]),
    );

    const result = await getFeatureDefinitionsWithCache({
      context: mockContext,
      params: {
        key: "test-cache-key-3",
        organization: mockContext.org.id,
        environment: "production",
        projects: ["project-2"],
        encryptPayload: false,
        encryptionKey: "",
        languages: ["javascript"],
        sdkVersion: "1.0.0",
      },
    });

    // Holdout projects ["project-2", "project-3"] includes the requested "project-2"
    expect(result.features["$holdout:hld_test_holdout"]).toMatchObject({
      defaultValue: "genpop",
      rules: [
        expect.objectContaining({
          coverage: 0.1,
          hashAttribute: "user_id",
          key: "holdout-tracking-key",
          seed: "holdout-seed",
          hashVersion: 2,
          variations: ["holdoutcontrol", "holdouttreatment"],
          weights: [0.5, 0.5],
        }),
      ],
    });

    expect(result.features["feature-with-holdout"].rules).toHaveLength(2);
    expect(result.features["feature-with-holdout"].rules?.[0]).toMatchObject({
      parentConditions: [
        {
          id: "$holdout:hld_test_holdout",
          condition: { value: "holdoutcontrol" },
        },
      ],
      force: "default_value",
    });
    expect(result.features["feature-with-holdout"].rules?.[1]).toMatchObject({
      force: "sample_value",
    });
  });

  it("should NOT include holdout rule when holdout feature definition is missing", async () => {
    // Mock features
    (getAllFeatures as jest.Mock).mockResolvedValue([
      {
        id: "feature-with-holdout",
        valueType: "string",
        defaultValue: "default_value",
        environmentSettings: {
          production: {
            enabled: true,
            rules: [
              {
                id: "sample_rule",
                value: "sample_value",
                type: "force",
                enabled: true,
              },
            ],
          },
        },
        project: "project-1",
        holdout: {
          id: "hld_test_holdout",
          value: "default_value",
        },
      },
    ]);

    // Mock holdouts
    (
      mockContext.models.holdout.getAllPayloadHoldouts as jest.Mock
    ).mockResolvedValue(new Map());

    const result = await getFeatureDefinitionsWithCache({
      context: mockContext,
      params: {
        key: "test-cache-key-4",
        organization: mockContext.org.id,
        environment: "production",
        projects: ["project-1"],
        encryptPayload: false,
        encryptionKey: "",
        languages: ["javascript"],
        sdkVersion: "1.0.0",
      },
    });

    // Verify feature does not have holdout rule
    expect(result.features["feature-with-holdout"].rules).toHaveLength(1);
  });

  it("should NOT include holdout feature definition when no feature has a holdout", async () => {
    // Mock features
    (getAllFeatures as jest.Mock).mockResolvedValue([
      {
        id: "feature-with-holdout",
        valueType: "string",
        defaultValue: "default_value",
        environmentSettings: {
          production: {
            enabled: true,
            rules: [
              {
                id: "sample_rule",
                value: "sample_value",
                type: "force",
                enabled: true,
              },
            ],
          },
        },
        project: "project-1",
      },
    ]);

    // Mock holdouts
    (
      mockContext.models.holdout.getAllPayloadHoldouts as jest.Mock
    ).mockResolvedValue(
      new Map([
        [
          "hld_test_holdout",
          {
            holdout: {
              id: "hld_test_holdout",
              name: "Test Holdout",
              projects: ["project-1", "project-2"],
              environment: "production",
              environmentSettings: {
                production: {
                  enabled: true,
                },
              },
            },
            holdoutExperiment: /* renamed from `experiment` on main */ {
              id: "exp_holdout",
              name: "Holdout Experiment",
              hashAttribute: "user_id",
              trackingKey: "holdout-tracking-key",
              phases: [
                {
                  dateStarted: new Date("2023-01-01"),
                  dateEnded: null,
                  coverage: 0.1,
                  seed: "holdout-seed",
                  variationWeights: [0.5, 0.5],
                },
              ],
            },
          },
        ],
      ]),
    );

    const result = await getFeatureDefinitionsWithCache({
      context: mockContext,
      params: {
        key: "test-cache-key-6",
        organization: mockContext.org.id,
        environment: "production",
        projects: ["project-1"],
        encryptPayload: false,
        encryptionKey: "",
        languages: ["javascript"],
        sdkVersion: "1.0.0",
      },
    });

    // Verify holdout feature definition is not included
    expect(result.features).not.toHaveProperty("$holdout:hld_test_holdout");
  });

  it("should include feature definitions normally when no holdouts are present", async () => {
    // Mock features
    (getAllFeatures as jest.Mock).mockResolvedValue([
      {
        id: "feature-1",
        valueType: "string",
        defaultValue: "default_value",
        environmentSettings: {
          production: {
            enabled: true,
            rules: [
              {
                id: "sample_rule",
                value: "sample_value",
                type: "force",
                enabled: true,
              },
            ],
          },
        },
        project: "project-1",
      },
      {
        id: "feature-2",
        valueType: "boolean",
        defaultValue: "true",
        environmentSettings: {
          production: {
            enabled: true,
            rules: [
              {
                id: "fr_123456",
                type: "force",
                description: "",
                value: "true",
                condition: '{"user_id":12345}',
                enabled: true,
              },
            ],
          },
        },
        project: "project-1",
      },
    ]);

    // Mock holdouts
    (
      mockContext.models.holdout.getAllPayloadHoldouts as jest.Mock
    ).mockResolvedValue(new Map());

    const result = await getFeatureDefinitionsWithCache({
      context: mockContext,
      params: {
        key: "test-cache-key-5",
        organization: mockContext.org.id,
        environment: "production",
        projects: ["project-1"],
        encryptPayload: false,
        encryptionKey: "",
        languages: ["javascript"],
        sdkVersion: "1.0.0",
      },
    });

    expect(result.features).toStrictEqual({
      "feature-1": {
        defaultValue: "default_value",
        rules: [{ force: "sample_value" }],
      },
      "feature-2": {
        defaultValue: true,
        rules: [
          {
            condition: {
              user_id: 12345,
            },
            force: true,
          },
        ],
      },
    });
  });
});
