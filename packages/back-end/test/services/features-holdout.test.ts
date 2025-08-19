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

  it("should include holdout when feature and holdout share the same project", async () => {
    // Mock features
    (getAllFeatures as jest.Mock).mockResolvedValue([
      {
        id: "feature-with-holdout",
        defaultValue: "default_value",
        environmentSettings: {
          production: {
            enabled: true,
            rules: [
              {
                id: "holdout_rule",
                parentConditions: [
                  {
                    id: "$holdout:hld_test_holdout",
                    condition: { value: "holdoutcontrol" },
                  },
                ],
                force: "holdout_value",
              },
            ],
          },
        },
        projects: ["project-2"],
      },
    ]);

    // Mock holdouts
    (
      mockContext.models.holdout.getAllPayloadHoldouts as jest.Mock
    ).mockResolvedValue(
      new Map([
        [
          "$holdout:hld_test_holdout",
          {
            id: "hld_test_holdout",
            name: "Test Holdout",
            projects: ["project-2"], // Same project as feature
            environment: "production",
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
  });

  it("should NOT include holdout when feature and holdout have different projects", async () => {
    // Mock features
    (getAllFeatures as jest.Mock).mockResolvedValue([
      {
        id: "feature-with-holdout",
        defaultValue: "default_value",
        environmentSettings: {
          production: {
            enabled: true,
            rules: [
              {
                id: "holdout_rule",
                parentConditions: [
                  {
                    id: "$holdout:hld_test_holdout",
                    condition: { value: "holdoutcontrol" },
                  },
                ],
                force: "holdout_value",
              },
            ],
          },
        },
        projects: ["project-1"], // Different project from holdout
      },
    ]);

    // Mock holdouts
    (
      mockContext.models.holdout.getAllPayloadHoldouts as jest.Mock
    ).mockResolvedValue(
      new Map([
        [
          "$holdout:hld_test_holdout",
          {
            id: "hld_test_holdout",
            name: "Test Holdout",
            projects: ["project-2"], // Different project from feature
            environment: "production",
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
  });
});
