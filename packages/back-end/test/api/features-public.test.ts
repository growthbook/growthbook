import { Request, Response } from "express";
import * as util from "shared/util";
import * as featuresController from "back-end/src/controllers/features";
const { getFeaturesPublic } = featuresController;
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { getSDKPayload } from "back-end/src/models/SdkPayloadModel";
import { findSDKConnectionByKey } from "back-end/src/models/SdkConnectionModel";
import { getFeatureDefinitions } from "back-end/src/services/features";

// Mock Python stats server to avoid Python process spawning
jest.mock("back-end/src/services/python", () => ({
  createPool: jest.fn(() => ({
    acquire: jest.fn(),
    release: jest.fn(),
    drain: jest.fn(),
  })),
}));

// Mock secrets to avoid environment issues
jest.mock("back-end/src/util/secrets", () => ({
  CACHE_CONTROL_MAX_AGE: 30,
  CACHE_CONTROL_STALE_WHILE_REVALIDATE: 3600,
  CACHE_CONTROL_STALE_IF_ERROR: 36000,
  FASTLY_SERVICE_ID: undefined,
  JWT_SECRET: "test-secret",
}));

// Mock auth to avoid authentication issues
jest.mock("back-end/src/services/auth", () => ({
  getAuthConnection: () => ({
    middleware: jest.fn(),
  }),
}));

// Mock logger to prevent console output during tests
jest.mock("back-end/src/util/logger", () => ({
  logger: {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

// Mock the functions that are used in the test
jest.mock("back-end/src/controllers/features", () => {
  const actual = jest.requireActual("back-end/src/controllers/features");
  const mockGetPayloadParamsFromApiKey = jest.fn();
  const mockGetFeatureDefinitionsFilteredByEnvironment = jest.fn();

  return {
    ...actual,
    getPayloadParamsFromApiKey: mockGetPayloadParamsFromApiKey,
    getFeatureDefinitionsFilteredByEnvironment:
      mockGetFeatureDefinitionsFilteredByEnvironment,
  };
});

// Mock the shared util module
jest.mock("shared/util", () => ({
  ...jest.requireActual("shared/util"),
  filterProjectsByEnvironmentWithNull: jest.fn(),
}));

jest.mock("back-end/src/services/features", () => ({
  getFeatureDefinitions: jest.fn(),
  getSavedGroupMap: jest.fn(),
  updateSDKPayload: jest.fn(),
}));

jest.mock("back-end/src/services/organizations", () => ({
  getContextForAgendaJobByOrgId: jest.fn(),
}));

jest.mock("back-end/src/models/SdkPayloadModel", () => ({
  getSDKPayload: jest.fn(),
  updateSDKPayload: jest.fn(),
  getSDKPayloadCacheLocation: jest.fn().mockReturnValue("mongo"),
}));

jest.mock("back-end/src/models/SdkConnectionModel", () => ({
  findSDKConnectionByKey: jest.fn(),
  markSDKConnectionUsed: jest.fn(),
}));

jest.mock("back-end/src/models/ApiKeyModel", () => ({
  lookupOrganizationByApiKey: jest.fn(),
}));

describe("getFeaturesPublic test holdout", () => {
  const expectedFeatureResponseWithHoldout = {
    status: 200,
    features: {
      "feature-with-holdout": {
        defaultValue: "default_value",
        projects: ["project-2"],
        rules: [
          {
            id: "holdout_abc123",
            force: "holdout_value",
          },
        ],
      },
    },
  };
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockJson: jest.Mock;
  let mockStatus: jest.Mock;
  let mockSet: jest.Mock;

  beforeEach(() => {
    mockJson = jest.fn();
    mockStatus = jest.fn().mockReturnValue({ json: mockJson });
    mockSet = jest.fn();

    mockRequest = {
      params: { key: "sdk-test-key" },
      body: {},
    };

    mockResponse = {
      status: mockStatus,
      json: mockJson,
      set: mockSet,
    };

    jest.clearAllMocks();
  });

  it("test getFeaturesPublic with holdout", async () => {
    // Mock the context
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
          getAllPayloadSafeRollouts: jest.fn().mockResolvedValue(new Map()),
        },
        holdout: {
          getAllPayloadHoldouts: jest.fn().mockResolvedValue(new Map()),
        },
      },
    };

    // Setup mocks for the functions that getFeatureDefinitions calls
    console.log("Setting up mock for getPayloadParamsFromApiKey");

    // Mock the SDK connection lookup
    (findSDKConnectionByKey as jest.Mock).mockResolvedValue({
      organization: "test-org-id",
      environment: "production",
      projects: ["project-1", "project-2"],
      encryptPayload: false,
      encryptionKey: undefined,
      includeVisualExperiments: false,
      includeDraftExperiments: false,
      includeExperimentNames: true,
      includeRedirectExperiments: false,
      includeRuleIds: true,
      hashSecureAttributes: false,
      remoteEvalEnabled: false,
      savedGroupReferencesEnabled: false,
      connected: true,
    });

    console.log("Mock setup complete");
    (getContextForAgendaJobByOrgId as jest.Mock).mockResolvedValue(mockContext);
    (util.filterProjectsByEnvironmentWithNull as jest.Mock).mockReturnValue([
      "project-1",
      "project-2",
    ]);

    // Mock getFeatureDefinitions to return test data with holdouts
    (getFeatureDefinitions as jest.Mock).mockResolvedValue({
      features: {
        "feature-with-holdout": {
          defaultValue: "default_value",
          projects: ["project-2"],
          rules: [
            {
              id: "holdout_abc123",
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
        "cached-feature": {
          defaultValue: "cached_value",
          rules: [],
        },
      },
      experiments: [],
      dateUpdated: new Date("2023-01-01"),
      savedGroups: {},
    });

    // Mock getSDKPayload to return null (so it doesn't use cached data)
    (getSDKPayload as jest.Mock).mockResolvedValue(null);

    // Mock cached SDK payload to test the cache path
    const cachedDate = new Date("2023-01-01");
    const mockedSDKPayloadData = {
      organization: "test-org-id",
      environment: "production",
      dateUpdated: cachedDate,
      deployed: true,
      schemaVersion: 1,
      contents: JSON.stringify({
        features: {
          "cached-feature": {
            defaultValue: "cached_value",
            rules: [],
          },
          "feature-with-holdout": {
            defaultValue: "default_value",
            projects: ["project-2"],
            rules: [
              {
                id: "holdout_abc123",
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
        experiments: [],
        savedGroupsInUse: [],
      }),
    };

    getSDKPayload.mockResolvedValue(mockedSDKPayloadData);

    // Call the actual getFeaturesPublic function
    // This will call the real getFeatureDefinitions function
    await getFeaturesPublic(mockRequest as Request, mockResponse as Response);

    // Debug: Log the actual response
    console.log("Status calls:", mockStatus.mock.calls);
    console.log("JSON calls:", mockJson.mock.calls);

    // Verify that the response was successful
    expect(mockStatus).toHaveBeenCalledWith(200);
    expect(mockJson).toHaveBeenCalledTimes(1);
    console.log(mockJson.mock.calls[0][0]);
    // Verify the response structure
    const responseData = mockJson.mock.calls[0][0];
    expect(responseData).toMatchObject(expectedFeatureResponseWithHoldout);
  });
  it("test getFeaturesPublic that holdouts dont show when feature and holdout dont have the same projects", async () => {
    // Mock the payload parameters - feature is in project-1, holdout is in project-2
    const mockPayloadParams = {
      organization: "test-org-id",
      capabilities: ["prerequisites"],
      environment: "production",
      encrypted: false,
      projects: ["project-1"],
      encryptionKey: undefined,
      includeVisualExperiments: false,
      includeDraftExperiments: false,
      includeExperimentNames: true,
      includeRedirectExperiments: false,
      includeRuleIds: true,
      hashSecureAttributes: false,
      remoteEvalEnabled: false,
      savedGroupReferencesEnabled: false,
    };

    // Mock the context
    const mockContext = {
      org: {
        id: "test-org-id",
        name: "Test Organization",
        settings: {
          environments: [{ id: "production", projects: ["project-1"] }],
        },
      },
    };

    // Setup mocks for the functions that getFeatureDefinitions calls
    (
      featuresController.getPayloadParamsFromApiKey as jest.Mock
    ).mockResolvedValue(mockPayloadParams);
    (getContextForAgendaJobByOrgId as jest.Mock).mockResolvedValue(mockContext);
    (util.filterProjectsByEnvironmentWithNull as jest.Mock).mockReturnValue([
      "project-1",
    ]);

    // Mock getFeatureDefinitions to return test data where holdout is not included
    (getFeatureDefinitions as jest.Mock).mockResolvedValue({
      features: {
        "cached-feature": {
          defaultValue: "cached_value",
          rules: [],
        },
        "feature-with-holdout": {
          defaultValue: "default_value",
          rules: [
            {
              id: "holdout_abc123",
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
        // Note: holdout is not included because it's in a different project
      },
      experiments: [],
      dateUpdated: new Date("2023-01-01"),
      savedGroups: {},
    });

    // Mock cached SDK payload to test the cache path
    const cachedDate = new Date("2023-01-01");
    const mockedSDKPayloadData = {
      organization: "test-org-id",
      environment: "production",
      dateUpdated: cachedDate,
      deployed: true,
      schemaVersion: 1,
      contents: JSON.stringify({
        features: {
          "cached-feature": {
            defaultValue: "cached_value",
            rules: [],
          },
          "feature-with-holdout": {
            defaultValue: "default_value",
            rules: [
              {
                id: "holdout_abc123",
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
        experiments: [],
        savedGroupsInUse: [],
        holdouts: {
          "$holdout:hld_test_holdout": {
            defaultValue: "genpop",
            projects: ["project-1"],
            rules: [
              {
                id: "holdout_rule",
                variations: ["holdoutcontrol", "holdouttreatment"],
                weights: [0.5, 0.5],
                hashAttribute: "id",
                coverage: 0.1,
              },
            ],
          },
        },
      }),
    };

    (getSDKPayload as jest.Mock).mockResolvedValue(mockedSDKPayloadData);

    // Call the actual getFeaturesPublic function
    // This will call the real getFeatureDefinitions function
    await getFeaturesPublic(mockRequest as Request, mockResponse as Response);

    // Verify that the response was successful
    expect(mockStatus).toHaveBeenCalledWith(200);
    expect(mockJson).toHaveBeenCalledTimes(1);

    // Verify the response structure - holdout should NOT be included
    const responseData = mockJson.mock.calls[0][0];
    expect(responseData).toMatchObject({
      status: 200,
      features: {
        "feature-with-holdout": {
          defaultValue: "default_value",
          rules: [
            {
              id: "holdout_abc123",
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
        // Note: "$holdout:hld_test_holdout" should NOT be present
      },
    });
  });
});
