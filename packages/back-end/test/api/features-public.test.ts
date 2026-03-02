import { Request, Response } from "express";
import * as featuresController from "back-end/src/controllers/features";
const { getFeaturesPublic } = featuresController;
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { findSDKConnectionByKey } from "back-end/src/models/SdkConnectionModel";
import { getFeatureDefinitions } from "back-end/src/services/features";

jest.mock("back-end/src/services/python", () => ({
  createPool: jest.fn(() => ({
    acquire: jest.fn(),
    release: jest.fn(),
    drain: jest.fn(),
  })),
}));

jest.mock("back-end/src/util/secrets", () => ({
  CACHE_CONTROL_MAX_AGE: 30,
  CACHE_CONTROL_STALE_WHILE_REVALIDATE: 3600,
  CACHE_CONTROL_STALE_IF_ERROR: 36000,
  FASTLY_SERVICE_ID: undefined,
  JWT_SECRET: "test-secret",
}));

jest.mock("back-end/src/services/auth", () => ({
  getAuthConnection: () => ({
    middleware: jest.fn(),
  }),
}));

jest.mock("back-end/src/util/logger", () => ({
  logger: {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock("back-end/src/controllers/features", () => {
  const actual = jest.requireActual("back-end/src/controllers/features");
  const mockGetPayloadParamsFromApiKey = jest.fn();

  return {
    ...actual,
    getPayloadParamsFromApiKey: mockGetPayloadParamsFromApiKey,
  };
});

jest.mock("shared/util", () => ({
  ...jest.requireActual("shared/util"),
  filterProjectsByEnvironmentWithNull: jest.fn(),
}));

jest.mock("back-end/src/services/features", () => ({
  getFeatureDefinitions: jest.fn(),
  getSavedGroupMap: jest.fn(),
}));

jest.mock("back-end/src/services/organizations", () => ({
  getContextForAgendaJobByOrgId: jest.fn(),
}));

jest.mock("back-end/src/models/SdkConnectionCacheModel", () => ({
  getSDKPayloadCacheLocation: jest.fn().mockReturnValue("none"),
  SdkConnectionCacheModel: jest.fn(),
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
    };

    (getContextForAgendaJobByOrgId as jest.Mock).mockResolvedValue(mockContext);

    // Mock the SDK connection lookup so getPayloadParamsFromApiKey works
    (findSDKConnectionByKey as jest.Mock).mockResolvedValue({
      key: "sdk-test-key",
      organization: "test-org-id",
      environment: "production",
      projects: ["project-1", "project-2"],
      encryptPayload: false,
      encryptionKey: "",
      languages: ["javascript"],
      sdkVersion: "1.0.0",
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

    // Mock getFeatureDefinitions (from services/features) to return test data with holdouts
    (getFeatureDefinitions as jest.Mock).mockResolvedValue({
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
      experiments: [],
      dateUpdated: new Date("2023-01-01"),
      savedGroups: {},
    });

    // Call the actual getFeaturesPublic function
    // This calls getFeatureDefinitionsWithCache which calls our mocked getFeatureDefinitions
    await getFeaturesPublic(mockRequest as Request, mockResponse as Response);

    // Verify that the response was successful
    if (mockStatus.mock.calls[0]?.[0] !== 200) {
      console.log("Error response:", mockJson.mock.calls[0]?.[0]);
    }
    expect(mockStatus).toHaveBeenCalledWith(200);
    expect(mockJson).toHaveBeenCalledTimes(1);

    // Verify the response structure
    const responseData = mockJson.mock.calls[0][0];
    expect(responseData).toMatchObject(expectedFeatureResponseWithHoldout);
  });

  it("test getFeaturesPublic that holdouts dont show when feature and holdout dont have the same projects", async () => {
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

    (getContextForAgendaJobByOrgId as jest.Mock).mockResolvedValue(mockContext);

    // Mock the SDK connection lookup so getPayloadParamsFromApiKey works
    (findSDKConnectionByKey as jest.Mock).mockResolvedValue({
      key: "sdk-test-key",
      organization: "test-org-id",
      environment: "production",
      projects: ["project-1"],
      encryptPayload: false,
      encryptionKey: "",
      languages: ["javascript"],
      sdkVersion: "1.0.0",
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

    // Mock getFeatureDefinitions to return test data where holdout is not included
    (getFeatureDefinitions as jest.Mock).mockResolvedValue({
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
        // Note: $holdout:hld_test_holdout is NOT included because it's in a different project
      },
      experiments: [],
      dateUpdated: new Date("2023-01-01"),
      savedGroups: {},
    });

    // Call the actual getFeaturesPublic function
    // This calls getFeatureDefinitionsWithCache which calls our mocked getFeatureDefinitions
    await getFeaturesPublic(mockRequest as Request, mockResponse as Response);

    // Verify that the response was successful
    expect(mockStatus).toHaveBeenCalledWith(200);
    expect(mockJson).toHaveBeenCalledTimes(1);

    // Verify the response structure - the feature has a rule with parentConditions
    // referencing a holdout that doesn't exist in the payload (dead reference)
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
      },
    });
    // Verify the holdout feature flag is not in the payload
    expect(responseData.features).not.toHaveProperty(
      "$holdout:hld_test_holdout",
    );
  });
});
