// Mock all model dependencies BEFORE importing the features service
jest.mock("back-end/src/models/FeatureModel", () => ({
  getAllFeatures: jest.fn(),
}));

jest.mock("back-end/src/models/ExperimentModel", () => ({
  getAllPayloadExperiments: jest.fn(),
  getAllVisualExperiments: jest.fn(),
  getAllURLRedirectExperiments: jest.fn(),
}));

jest.mock("back-end/src/models/SavedGroupModel", () => ({
  getAllSavedGroups: jest.fn(),
  getSavedGroupsById: jest.fn(),
}));

jest.mock("back-end/src/models/SdkPayloadModel", () => ({
  getSDKPayload: jest.fn(),
  updateSDKPayload: jest.fn(),
  getSDKPayloadCacheLocation: jest.fn().mockReturnValue("mongo"),
}));

// Now import the features service after mocking its dependencies
import { getFeatureDefinitions } from "back-end/src/services/features";

// Import mocked dependencies
import { getAllFeatures } from "back-end/src/models/FeatureModel";
import {
  getAllPayloadExperiments,
  getAllVisualExperiments,
  getAllURLRedirectExperiments,
} from "back-end/src/models/ExperimentModel";
import {
  getAllSavedGroups,
  getSavedGroupsById,
} from "back-end/src/models/SavedGroupModel";
import {
  getSDKPayload,
  updateSDKPayload,
} from "back-end/src/models/SdkPayloadModel";
import { ReqContext } from "../../types/organization";

// Mock shared/util functions
jest.mock("shared/util", () => ({
  ...jest.requireActual("shared/util"),
  getSavedGroupsValuesFromInterfaces: jest.fn().mockReturnValue({}),
}));

// Mock config to prevent MongoDB log messages
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

describe("getFeatureDefinitions - Holdout Tests", () => {
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
    },
    userId: "test-user",
    email: "test@example.com",
    userName: "Test User",
    initModels: jest.fn(),
  } as unknown as ReqContext;

  beforeEach(() => {
    jest.clearAllMocks();

    (getSDKPayload as jest.Mock).mockResolvedValue(null);
    (updateSDKPayload as jest.Mock).mockResolvedValue(undefined);
    (getAllSavedGroups as jest.Mock).mockResolvedValue([]);
    (getSavedGroupsById as jest.Mock).mockResolvedValue([]);
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
            experiment: {
              id: "exp_holdout",
              name: "Holdout Experiment",
              phases: [
                {
                  dateStarted: new Date("2023-01-01"),
                  dateEnded: null,
                  coverage: 0.1,
                  variationWeights: [0.5, 0.5],
                },
              ],
            },
          },
        ],
      ]),
    );

    const result = await getFeatureDefinitions({
      context: mockContext,
      capabilities: ["prerequisites"],
      environment: "production",
      projects: ["project-2"],
    });

    // Verify holdout is included
    expect(result.features).toHaveProperty("$holdout:hld_test_holdout");
    expect(result.features["$holdout:hld_test_holdout"].defaultValue).toBe(
      "genpop",
    );
    // Verify feature has holdout rule
    expect(result.features["feature-with-holdout"].rules).toHaveLength(2);
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
            experiment: {
              id: "exp_holdout",
              name: "Holdout Experiment",
              phases: [
                {
                  dateStarted: new Date("2023-01-01"),
                  dateEnded: null,
                  coverage: 0.1,
                  variationWeights: [0.5, 0.5],
                },
              ],
            },
          },
        ],
      ]),
    );

    const result = await getFeatureDefinitions({
      context: mockContext,
      capabilities: ["prerequisites"],
      environment: "production",
      projects: ["project-1"], // Only requesting project-1
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
            experiment: {
              id: "exp_holdout",
              name: "Holdout Experiment",
              phases: [
                {
                  dateStarted: new Date("2023-01-01"),
                  dateEnded: null,
                  coverage: 0.1,
                  variationWeights: [0.5, 0.5],
                },
              ],
            },
          },
        ],
      ]),
    );

    const result = await getFeatureDefinitions({
      context: mockContext,
      capabilities: ["prerequisites"],
      environment: "production",
      projects: ["project-2"], // Only requesting project-2
    });

    // Verify holdout is included
    expect(result.features).toHaveProperty("$holdout:hld_test_holdout");
    expect(result.features["$holdout:hld_test_holdout"].defaultValue).toBe(
      "genpop",
    );
    // Verify feature has holdout rule
    expect(result.features["feature-with-holdout"].rules).toHaveLength(2);
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

    const result = await getFeatureDefinitions({
      context: mockContext,
      capabilities: ["prerequisites"],
      environment: "production",
      projects: ["project-1"], // Only requesting project-1
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
            experiment: {
              id: "exp_holdout",
              name: "Holdout Experiment",
              phases: [
                {
                  dateStarted: new Date("2023-01-01"),
                  dateEnded: null,
                  coverage: 0.1,
                  variationWeights: [0.5, 0.5],
                },
              ],
            },
          },
        ],
      ]),
    );

    const result = await getFeatureDefinitions({
      context: mockContext,
      capabilities: ["prerequisites"],
      environment: "production",
      projects: ["project-1"], // Only requesting project-1
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

    const result = await getFeatureDefinitions({
      context: mockContext,
      capabilities: ["prerequisites"],
      environment: "production",
      projects: ["project-1"], // Only requesting project-1
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
