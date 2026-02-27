/**
 * Comprehensive SDK payload lifecycle test suite.
 * Standalone: covers cache layer, params resolution, refresh flow, queueing,
 * and shared-state immutability without relying on other test files.
 *
 * Dimensions: isSDKConnectionAffectedByPayloadKey, getFeatureDefinitionsWithCache
 * (hit/miss/storage none), getPayloadParamsFromApiKey (sdk vs legacy),
 * refreshSDKPayloadCache (bulk/targeted, mocks, no mutation), queueSDKPayloadRefresh.
 */

import cloneDeep from "lodash/cloneDeep";
import { FeatureInterface } from "shared/types/feature";
import { ExperimentInterface } from "shared/types/experiment";
import { GroupMap, SavedGroupInterface } from "shared/types/saved-group";
import { SafeRolloutInterface } from "shared/types/safe-rollout";
import { ApiReqContext } from "back-end/types/api";
import { ReqContext } from "back-end/types/request";
import {
  buildSDKPayloadForConnection,
  getFeatureDefinitions,
  isSDKConnectionAffectedByPayloadKey,
  queueSDKPayloadRefresh,
  refreshSDKPayloadCache,
  type SDKPayloadRawData,
  type ConnectionPayloadOptions,
} from "back-end/src/services/features";
import { SDKConnectionInterface } from "shared/types/sdk-connection";
import { getFeatureDefinitionsWithCache, getPayloadParamsFromApiKey } from "back-end/src/controllers/features";
import * as FeatureModel from "back-end/src/models/FeatureModel";
import * as ExperimentModel from "back-end/src/models/ExperimentModel";
import * as featuresService from "back-end/src/services/features";

jest.mock("back-end/src/models/SdkConnectionModel", () => ({
  findSDKConnectionByKey: jest.fn(),
  findSDKConnectionsByOrganization: jest.fn(),
  markSDKConnectionUsed: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("back-end/src/models/OrganizationModel", () => ({}));
jest.mock("back-end/src/models/ApiKeyModel", () => ({
  lookupOrganizationByApiKey: jest.fn(),
}));
jest.mock("back-end/src/models/SdkConnectionCacheModel", () => ({
  ...jest.requireActual("back-end/src/models/SdkConnectionCacheModel"),
  getSDKPayloadCacheLocation: jest.fn(),
}));
jest.mock("back-end/src/models/FeatureModel", () => ({
  getAllFeatures: jest.fn().mockResolvedValue([]),
}));
jest.mock("back-end/src/models/ExperimentModel", () => ({
  getAllPayloadExperiments: jest.fn().mockResolvedValue(new Map()),
  getAllVisualExperiments: jest.fn().mockResolvedValue([]),
  getAllURLRedirectExperiments: jest.fn().mockResolvedValue([]),
}));
jest.mock("back-end/src/services/organizations", () => ({
  getContextForAgendaJobByOrgObject: jest.fn((org: { id: string }) => ({
    org,
    models: (global as unknown as { __mockContextModels: unknown }).__mockContextModels,
    userId: "u",
    email: "e@e.com",
    userName: "U",
    initModels: jest.fn(),
  })),
  getEnvironmentIdsFromOrg: jest.fn((org: { settings?: { environments?: { id: string }[] } }) =>
    org.settings?.environments?.map((e) => e.id) ?? ["production"],
  ),
}));
jest.mock("back-end/src/jobs/updateAllJobs", () => ({
  triggerWebhookJobs: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("back-end/src/services/features", () => ({
  ...jest.requireActual("back-end/src/services/features"),
  getFeatureDefinitions: jest.fn(),
}));

const findSDKConnectionByKey = jest.requireMock("back-end/src/models/SdkConnectionModel")
  .findSDKConnectionByKey as jest.Mock;
const lookupOrganizationByApiKey = jest.requireMock("back-end/src/models/ApiKeyModel")
  .lookupOrganizationByApiKey as jest.Mock;
const getSDKPayloadCacheLocationMock = jest.requireMock(
  "back-end/src/models/SdkConnectionCacheModel",
).getSDKPayloadCacheLocation as jest.Mock;
const findSDKConnectionsByOrganization = jest.requireMock("back-end/src/models/SdkConnectionModel")
  .findSDKConnectionsByOrganization as jest.Mock;
const getContextForAgendaJobByOrgObject = jest.requireMock("back-end/src/services/organizations")
  .getContextForAgendaJobByOrgObject as jest.Mock;
const triggerWebhookJobs = jest.requireMock("back-end/src/jobs/updateAllJobs").triggerWebhookJobs as jest.Mock;

function minimalContext(overrides?: Partial<ApiReqContext>): ApiReqContext {
  return {
    org: {
      id: "org-1",
      name: "Test",
      url: "",
      dateCreated: new Date(),
      ownerEmail: "",
      members: [],
      invites: [],
      settings: { environments: [{ id: "production", projects: [] }] },
    },
    models: {} as ApiReqContext["models"],
    userId: "u1",
    email: "e@e.com",
    userName: "User",
    initModels: () => {},
    ...overrides,
  } as ApiReqContext;
}

function minimalRawData(overrides?: Partial<SDKPayloadRawData>): SDKPayloadRawData {
  return {
    features: [],
    experimentMap: new Map(),
    groupMap: new Map(),
    safeRolloutMap: new Map(),
    savedGroups: [],
    holdoutsMap: new Map(),
    ...overrides,
  };
}

describe("SDK payload lifecycle (comprehensive)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (global as unknown as { __mockContextModels: unknown }).__mockContextModels = undefined;
  });

  describe("isSDKConnectionAffectedByPayloadKey", () => {
    const conn = (overrides: Partial<SDKConnectionInterface> = {}): SDKConnectionInterface =>
      ({
        key: "sdk-key-1",
        organization: "org-1",
        name: "Conn",
        environment: "production",
        projects: ["p1", "p2"],
        ...overrides,
      }) as SDKConnectionInterface;

    it("returns false when environment does not match", () => {
      expect(
        isSDKConnectionAffectedByPayloadKey(conn({ environment: "production" }), {
          environment: "dev",
          project: "p1",
        }),
      ).toBe(false);
    });

    it("returns true when environment matches and connection has no projects (global)", () => {
      expect(
        isSDKConnectionAffectedByPayloadKey(conn({ projects: [] }), {
          environment: "production",
          project: "p1",
        }),
      ).toBe(true);
    });

    it("returns true when environment matches and connection projects include payload project", () => {
      expect(
        isSDKConnectionAffectedByPayloadKey(conn(), {
          environment: "production",
          project: "p1",
        }),
      ).toBe(true);
    });

    it("returns false when environment matches but connection projects do not include payload project", () => {
      expect(
        isSDKConnectionAffectedByPayloadKey(conn(), {
          environment: "production",
          project: "p3",
        }),
      ).toBe(false);
    });

    it("treatEmptyProjectAsGlobal: payload with no project affects all connections in env", () => {
      expect(
        isSDKConnectionAffectedByPayloadKey(
          conn({ environment: "production", projects: ["p1"] }),
          { environment: "production", project: "" },
          true,
        ),
      ).toBe(true);
    });
  });

  describe("getFeatureDefinitionsWithCache", () => {
    const mockGetById = jest.fn();
    const mockUpsert = jest.fn().mockResolvedValue(undefined);

    it("returns parsed cache when storage !== none and getById returns content", async () => {
      getSDKPayloadCacheLocationMock.mockReturnValue("mongodb");
      const cached = { features: { f1: { defaultValue: "cached" } }, dateUpdated: new Date().toISOString() };
      mockGetById.mockResolvedValueOnce({ contents: JSON.stringify(cached) });

      const ctx = minimalContext({
        models: {
          ...minimalContext().models,
          sdkConnectionCache: { getById: mockGetById, upsert: mockUpsert },
        },
      } as ReqContext["models"]);

      const defs = await getFeatureDefinitionsWithCache({
        context: ctx as ReqContext,
        params: {
          key: "sdk-conn-1",
          organization: "org-1",
          environment: "production",
          projects: [],
          languages: ["javascript"],
          sdkVersion: "1.0.0",
        },
      });

      expect(mockGetById).toHaveBeenCalledWith("sdk-conn-1");
      expect(defs.features).toEqual({ f1: { defaultValue: "cached" } });
      expect(mockUpsert).not.toHaveBeenCalled();
    });

    it("on cache miss calls getFeatureDefinitions and upserts with params.key", async () => {
      getSDKPayloadCacheLocationMock.mockReturnValue("mongodb");
      mockGetById.mockResolvedValueOnce(null);
      (getFeatureDefinitions as jest.Mock).mockResolvedValueOnce({
        features: { f1: { defaultValue: "generated" } },
        dateUpdated: new Date(),
        experiments: [],
      });

      const ctx = minimalContext({
        models: {
          ...minimalContext().models,
          sdkConnectionCache: { getById: mockGetById, upsert: mockUpsert },
          savedGroups: { getAll: jest.fn().mockResolvedValue([]) },
          safeRollout: { getAllPayloadSafeRollouts: jest.fn().mockResolvedValue(new Map()) },
          holdout: { getAllPayloadHoldouts: jest.fn().mockResolvedValue(new Map()) },
        },
      } as ReqContext["models"]);

      await getFeatureDefinitionsWithCache({
        context: ctx as ReqContext,
        params: {
          key: "sdk-miss-key",
          organization: "org-1",
          environment: "production",
          projects: [],
          languages: ["javascript"],
          sdkVersion: "1.0.0",
        },
      });

      expect(getFeatureDefinitions).toHaveBeenCalled();
      expect(mockUpsert).toHaveBeenCalledWith(
        "sdk-miss-key",
        expect.any(String),
        expect.objectContaining({ event: "cache-miss" }),
      );
    });

    it("when storage is none skips cache read and write", async () => {
      getSDKPayloadCacheLocationMock.mockReturnValue("none");
      (getFeatureDefinitions as jest.Mock).mockResolvedValueOnce({
        features: {},
        dateUpdated: new Date(),
        experiments: [],
      });

      const ctx = minimalContext({
        models: {
          ...minimalContext().models,
          sdkConnectionCache: { getById: mockGetById, upsert: mockUpsert },
          savedGroups: { getAll: jest.fn().mockResolvedValue([]) },
          safeRollout: { getAllPayloadSafeRollouts: jest.fn().mockResolvedValue(new Map()) },
          holdout: { getAllPayloadHoldouts: jest.fn().mockResolvedValue(new Map()) },
        },
      } as ReqContext["models"]);

      await getFeatureDefinitionsWithCache({
        context: ctx as ReqContext,
        params: {
          key: "any",
          organization: "org-1",
          environment: "production",
          projects: [],
          languages: ["javascript"],
          sdkVersion: "1.0.0",
        },
      });

      expect(mockGetById).not.toHaveBeenCalled();
      expect(mockUpsert).not.toHaveBeenCalled();
      expect(getFeatureDefinitions).toHaveBeenCalled();
    });
  });

  describe("getPayloadParamsFromApiKey", () => {
    it("sdk-* key returns connection params from findSDKConnectionByKey", async () => {
      const connection = {
        key: "sdk-abc",
        organization: "org-1",
        environment: "production",
        projects: ["p1"],
        languages: ["javascript"],
        sdkVersion: "1.0.0",
      } as SDKConnectionInterface;
      findSDKConnectionByKey.mockResolvedValue(connection);

      const params = await getPayloadParamsFromApiKey("sdk-abc", {} as never);
      expect(findSDKConnectionByKey).toHaveBeenCalledWith("sdk-abc");
      expect(params.key).toBe("sdk-abc");
      expect(params.organization).toBe("org-1");
      expect(params.environment).toBe("production");
      expect(params.languages).toEqual(["javascript"]);
    });

    it("non-sdk key uses lookupOrganizationByApiKey and formatLegacyCacheKey", async () => {
      lookupOrganizationByApiKey.mockResolvedValue({
        organization: "org-1",
        secret: false,
        environment: "production",
        project: "proj1",
        encryptSDK: false,
        encryptionKey: "",
      });
      const params = await getPayloadParamsFromApiKey("pk_legacy", { query: {} } as never);
      expect(lookupOrganizationByApiKey).toHaveBeenCalledWith("pk_legacy");
      expect(params.key).toMatch(/^legacy:/);
      expect(params.languages).toEqual(["legacy"]);
      expect(params.sdkVersion).toBe("0.0.0");
    });
  });

  describe("refreshSDKPayloadCache", () => {
    it("bulk path: deleteAllLegacyCacheEntries, load rawData once, findSDKConnectionsByOrganization, build+upsert per connection, triggerWebhookJobs", async () => {
      getSDKPayloadCacheLocationMock.mockReturnValue("mongo");
      const deleteAllLegacy = jest.fn().mockResolvedValue(undefined);
      const upsert = jest.fn().mockResolvedValue(undefined);
      const conn1 = { key: "sdk-1", organization: "org-1", environment: "production", projects: [] } as SDKConnectionInterface;
      const conn2 = { key: "sdk-2", organization: "org-1", environment: "production", projects: [] } as SDKConnectionInterface;
      findSDKConnectionsByOrganization.mockResolvedValue([conn1, conn2]);
      (FeatureModel.getAllFeatures as jest.Mock).mockResolvedValue([]);
      (ExperimentModel.getAllPayloadExperiments as jest.Mock).mockResolvedValue(new Map());
      (ExperimentModel.getAllVisualExperiments as jest.Mock).mockResolvedValue([]);
      (ExperimentModel.getAllURLRedirectExperiments as jest.Mock).mockResolvedValue([]);

      const mockModels = {
        sdkConnectionCache: { deleteAllLegacyCacheEntries: deleteAllLegacy, upsert },
        safeRollout: { getAllPayloadSafeRollouts: jest.fn().mockResolvedValue(new Map()) },
        savedGroups: { getAll: jest.fn().mockResolvedValue([]) },
        holdout: { getAllPayloadHoldouts: jest.fn().mockResolvedValue(new Map()) },
      };
      (global as unknown as { __mockContextModels: unknown }).__mockContextModels = mockModels;

      await refreshSDKPayloadCache({
        context: minimalContext({ models: mockModels as ReqContext["models"] }) as ReqContext,
        payloadKeys: [{ environment: "production", project: "p1" }],
        sdkConnections: [],
      });

      expect(deleteAllLegacy).toHaveBeenCalled();
      expect(FeatureModel.getAllFeatures).toHaveBeenCalled();
      expect(findSDKConnectionsByOrganization).toHaveBeenCalled();
      expect(upsert).toHaveBeenCalledTimes(2);
      expect(upsert).toHaveBeenCalledWith("sdk-1", expect.any(String), undefined);
      expect(upsert).toHaveBeenCalledWith("sdk-2", expect.any(String), undefined);
      expect(triggerWebhookJobs).toHaveBeenCalled();
    });

    it("targeted path: uses sdkConnectionsToUpdate, does not call findSDKConnectionsByOrganization", async () => {
      getSDKPayloadCacheLocationMock.mockReturnValue("mongo");
      const deleteAllLegacy = jest.fn().mockResolvedValue(undefined);
      const upsert = jest.fn().mockResolvedValue(undefined);
      const conn = { key: "sdk-single", organization: "org-1", environment: "production", projects: [] } as SDKConnectionInterface;

      (FeatureModel.getAllFeatures as jest.Mock).mockResolvedValue([]);
      (ExperimentModel.getAllPayloadExperiments as jest.Mock).mockResolvedValue(new Map());
      (ExperimentModel.getAllVisualExperiments as jest.Mock).mockResolvedValue([]);
      (ExperimentModel.getAllURLRedirectExperiments as jest.Mock).mockResolvedValue([]);

      const mockModels = {
        sdkConnectionCache: { deleteAllLegacyCacheEntries: deleteAllLegacy, upsert },
        safeRollout: { getAllPayloadSafeRollouts: jest.fn().mockResolvedValue(new Map()) },
        savedGroups: { getAll: jest.fn().mockResolvedValue([]) },
        holdout: { getAllPayloadHoldouts: jest.fn().mockResolvedValue(new Map()) },
      };
      (global as unknown as { __mockContextModels: unknown }).__mockContextModels = mockModels;

      await refreshSDKPayloadCache({
        context: minimalContext({ models: mockModels as ReqContext["models"] }) as ReqContext,
        payloadKeys: [],
        sdkConnections: [conn],
      });

      expect(findSDKConnectionsByOrganization).not.toHaveBeenCalled();
      expect(upsert).toHaveBeenCalledTimes(1);
      expect(upsert).toHaveBeenCalledWith("sdk-single", expect.any(String), undefined);
    });

    it("shared rawData is not mutated when building multiple connection payloads", async () => {
      const ctx = minimalContext();
      const f1: FeatureInterface = {
        id: "f1",
        project: "",
        dateCreated: new Date(),
        dateUpdated: new Date(),
        defaultValue: true,
        organization: "org-1",
        owner: "",
        valueType: "boolean",
        archived: false,
        description: "",
        version: 1,
        environmentSettings: { production: { enabled: true, rules: [] } },
      } as FeatureInterface;
      const rawData = minimalRawData({
        features: [cloneDeep(f1)],
        experimentMap: new Map(),
        groupMap: new Map(),
        safeRolloutMap: new Map(),
        savedGroups: [],
        holdoutsMap: new Map(),
      });

      const conn1: ConnectionPayloadOptions = { capabilities: [], environment: "production", projects: [] };
      const conn2: ConnectionPayloadOptions = { capabilities: ["bucketingV2"], environment: "production", projects: [] };

      await buildSDKPayloadForConnection({ context: ctx, connection: conn1, data: rawData });
      const afterFirst = { length: rawData.features.length, id: rawData.features[0]?.id };
      await buildSDKPayloadForConnection({ context: ctx, connection: conn2, data: rawData });
      expect(rawData.features.length).toBe(afterFirst.length);
      expect(rawData.features[0]?.id).toBe(afterFirst.id);
    });
  });

  describe("queueSDKPayloadRefresh", () => {
    it("runs refresh and updates cache when given payloadKeys (bulk path)", async () => {
      getSDKPayloadCacheLocationMock.mockReturnValue("mongo");
      const deleteAllLegacy = jest.fn().mockResolvedValue(undefined);
      const upsert = jest.fn().mockResolvedValue(undefined);
      const conn = { key: "sdk-q1", organization: "org-1", environment: "production", projects: [] } as SDKConnectionInterface;
      findSDKConnectionsByOrganization.mockResolvedValue([conn]);
      (FeatureModel.getAllFeatures as jest.Mock).mockResolvedValue([]);
      (ExperimentModel.getAllPayloadExperiments as jest.Mock).mockResolvedValue(new Map());
      (ExperimentModel.getAllVisualExperiments as jest.Mock).mockResolvedValue([]);
      (ExperimentModel.getAllURLRedirectExperiments as jest.Mock).mockResolvedValue([]);
      const mockModels = {
        sdkConnectionCache: { deleteAllLegacyCacheEntries: deleteAllLegacy, upsert },
        safeRollout: { getAllPayloadSafeRollouts: jest.fn().mockResolvedValue(new Map()) },
        savedGroups: { getAll: jest.fn().mockResolvedValue([]) },
        holdout: { getAllPayloadHoldouts: jest.fn().mockResolvedValue(new Map()) },
      };
      (global as unknown as { __mockContextModels: unknown }).__mockContextModels = mockModels;

      queueSDKPayloadRefresh({
        context: minimalContext({ models: mockModels as ReqContext["models"] }) as ReqContext,
        payloadKeys: [{ environment: "production", project: "p1" }],
      });

      await new Promise((r) => setTimeout(r, 50));
      expect(findSDKConnectionsByOrganization).toHaveBeenCalled();
      expect(upsert).toHaveBeenCalledTimes(1);
      expect(upsert).toHaveBeenCalledWith("sdk-q1", expect.any(String), undefined);
    });

    it("runs refresh for given sdkConnections (targeted path)", async () => {
      getSDKPayloadCacheLocationMock.mockReturnValue("mongo");
      const deleteAllLegacy = jest.fn().mockResolvedValue(undefined);
      const upsert = jest.fn().mockResolvedValue(undefined);
      const conn = { key: "sdk-q2", organization: "org-1", environment: "production", projects: [] } as SDKConnectionInterface;
      (FeatureModel.getAllFeatures as jest.Mock).mockResolvedValue([]);
      (ExperimentModel.getAllPayloadExperiments as jest.Mock).mockResolvedValue(new Map());
      (ExperimentModel.getAllVisualExperiments as jest.Mock).mockResolvedValue([]);
      (ExperimentModel.getAllURLRedirectExperiments as jest.Mock).mockResolvedValue([]);
      const mockModels = {
        sdkConnectionCache: { deleteAllLegacyCacheEntries: deleteAllLegacy, upsert },
        safeRollout: { getAllPayloadSafeRollouts: jest.fn().mockResolvedValue(new Map()) },
        savedGroups: { getAll: jest.fn().mockResolvedValue([]) },
        holdout: { getAllPayloadHoldouts: jest.fn().mockResolvedValue(new Map()) },
      };
      (global as unknown as { __mockContextModels: unknown }).__mockContextModels = mockModels;

      queueSDKPayloadRefresh({
        context: minimalContext({ models: mockModels as ReqContext["models"] }) as ReqContext,
        payloadKeys: [],
        sdkConnections: [conn],
      });

      await new Promise((r) => setTimeout(r, 50));
      expect(findSDKConnectionsByOrganization).not.toHaveBeenCalled();
      expect(upsert).toHaveBeenCalledTimes(1);
      expect(upsert).toHaveBeenCalledWith("sdk-q2", expect.any(String), undefined);
    });
  });
});
