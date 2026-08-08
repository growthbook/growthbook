/**
 * queueSDKPayloadRefresh / refreshStaleSdkConnectionsForOrg with
 * SDK_PAYLOAD_REFRESH_STALE_TRACKING_ENABLED enabled. Split from
 * sdk-payload-lifecycle.test.ts because jest.mock("back-end/src/util/secrets")
 * is hoisted per-file, so the "enabled" and "disabled" (default) behavior
 * can't share one file.
 */

import { SDKConnectionInterface } from "shared/types/sdk-connection";
import { ApiReqContext } from "back-end/types/api";
import { ReqContext } from "back-end/types/request";
import {
  queueSDKPayloadRefresh,
  refreshStaleSdkConnectionsForOrg,
} from "back-end/src/services/features";
import * as FeatureModel from "back-end/src/models/FeatureModel";
import * as ExperimentModel from "back-end/src/models/ExperimentModel";

jest.mock("back-end/src/util/secrets", () => ({
  ...jest.requireActual("back-end/src/util/secrets"),
  SDK_PAYLOAD_REFRESH_STALE_TRACKING_ENABLED: true,
}));

jest.mock("back-end/src/models/SdkConnectionModel", () => ({
  findSDKConnectionByKey: jest.fn(),
  findSDKConnectionsByOrganization: jest.fn(),
  markSDKConnectionUsed: jest.fn().mockResolvedValue(undefined),
  markSdkConnectionsStale: jest.fn(),
  findStaleSdkConnectionsByOrganization: jest.fn(),
  clearStaleSdkConnections: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("back-end/src/jobs/refreshStaleSdkConnections", () => ({
  scheduleOrgRefreshJob: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("back-end/src/models/OrganizationModel", () => ({}));
jest.mock("back-end/src/models/ApiKeyModel", () => ({}));
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
    models: (global as unknown as { __mockContextModels: unknown })
      .__mockContextModels,
    userId: "u",
    email: "e@e.com",
    userName: "U",
    initModels: jest.fn(),
  })),
  getEnvironmentIdsFromOrg: jest.fn(
    (org: { settings?: { environments?: { id: string }[] } }) =>
      org.settings?.environments?.map((e) => e.id) ?? ["production"],
  ),
}));
jest.mock("back-end/src/jobs/updateAllJobs", () => ({
  triggerWebhookJobs: jest.fn().mockResolvedValue(undefined),
}));

const getSDKPayloadCacheLocationMock = jest.requireMock(
  "back-end/src/models/SdkConnectionCacheModel",
).getSDKPayloadCacheLocation as jest.Mock;
const sdkConnectionModelMock = jest.requireMock(
  "back-end/src/models/SdkConnectionModel",
);
const findSDKConnectionsByOrganization =
  sdkConnectionModelMock.findSDKConnectionsByOrganization as jest.Mock;
const markSdkConnectionsStale =
  sdkConnectionModelMock.markSdkConnectionsStale as jest.Mock;
const findStaleSdkConnectionsByOrganization =
  sdkConnectionModelMock.findStaleSdkConnectionsByOrganization as jest.Mock;
const clearStaleSdkConnections =
  sdkConnectionModelMock.clearStaleSdkConnections as jest.Mock;
const scheduleOrgRefreshJob = jest.requireMock(
  "back-end/src/jobs/refreshStaleSdkConnections",
).scheduleOrgRefreshJob as jest.Mock;

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
    isApiRequest: true,
    ...overrides,
  } as ApiReqContext;
}

function mockRefreshDependencies(upsert: jest.Mock) {
  getSDKPayloadCacheLocationMock.mockReturnValue("mongo");
  (FeatureModel.getAllFeatures as jest.Mock).mockResolvedValue([]);
  (ExperimentModel.getAllPayloadExperiments as jest.Mock).mockResolvedValue(
    new Map(),
  );
  (ExperimentModel.getAllVisualExperiments as jest.Mock).mockResolvedValue([]);
  (ExperimentModel.getAllURLRedirectExperiments as jest.Mock).mockResolvedValue(
    [],
  );
  const mockModels = {
    sdkConnectionCache: {
      deleteAllLegacyCacheEntries: jest.fn().mockResolvedValue(undefined),
      upsert,
    },
    safeRollout: {
      getAllPayloadSafeRollouts: jest.fn().mockResolvedValue(new Map()),
    },
    savedGroups: { getAll: jest.fn().mockResolvedValue([]) },
    constants: { getAll: jest.fn().mockResolvedValue([]) },
    configs: { getAll: jest.fn().mockResolvedValue([]) },
    holdout: { getAllPayloadHoldouts: jest.fn().mockResolvedValue(new Map()) },
    rampSchedules: {
      getPayloadRampMonitoredRuleMap: jest.fn().mockResolvedValue(new Map()),
    },
  };
  (global as unknown as { __mockContextModels: unknown }).__mockContextModels =
    mockModels;
  return mockModels;
}

const conn = (key: string): SDKConnectionInterface =>
  ({
    key,
    organization: "org-1",
    environment: "production",
    projects: [],
  }) as SDKConnectionInterface;

describe("queueSDKPayloadRefresh (stale tracking enabled)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (
      global as unknown as { __mockContextModels: unknown }
    ).__mockContextModels = undefined;
  });

  it("marks the affected connection stale and enqueues the org's refresh job", async () => {
    const upsert = jest.fn().mockResolvedValue(undefined);
    const mockModels = mockRefreshDependencies(upsert);
    const connA = conn("sdk-A");

    findSDKConnectionsByOrganization.mockResolvedValue([connA]);
    markSdkConnectionsStale.mockResolvedValue(undefined);

    queueSDKPayloadRefresh({
      context: minimalContext({
        models: mockModels as ReqContext["models"],
      }) as ReqContext,
      payloadKeys: [{ environment: "production", project: "" }],
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(markSdkConnectionsStale).toHaveBeenCalledWith("org-1", ["sdk-A"]);
    expect(scheduleOrgRefreshJob).toHaveBeenCalledWith("org-1");
    // The actual rebuild happens inside the job, not inline here.
    expect(upsert).not.toHaveBeenCalled();
  });

  it("still enqueues even when the org already has other pending staleness — Agenda's uniqueness collapses concurrent enqueues onto one job", async () => {
    const upsert = jest.fn().mockResolvedValue(undefined);
    const mockModels = mockRefreshDependencies(upsert);
    const connB = conn("sdk-B");

    findSDKConnectionsByOrganization.mockResolvedValue([connB]);
    markSdkConnectionsStale.mockResolvedValue(undefined);

    queueSDKPayloadRefresh({
      context: minimalContext({
        models: mockModels as ReqContext["models"],
      }) as ReqContext,
      payloadKeys: [{ environment: "production", project: "" }],
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(scheduleOrgRefreshJob).toHaveBeenCalledWith("org-1");
  });

  it("does nothing when no connection is affected by the write", async () => {
    const upsert = jest.fn().mockResolvedValue(undefined);
    const mockModels = mockRefreshDependencies(upsert);

    // Connection is in a different environment, so it doesn't match.
    findSDKConnectionsByOrganization.mockResolvedValue([
      { ...conn("sdk-C"), environment: "staging" },
    ]);

    queueSDKPayloadRefresh({
      context: minimalContext({
        models: mockModels as ReqContext["models"],
      }) as ReqContext,
      payloadKeys: [{ environment: "production", project: "" }],
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(markSdkConnectionsStale).not.toHaveBeenCalled();
    expect(scheduleOrgRefreshJob).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("falls back to an immediate direct refresh if stale-tracking itself fails", async () => {
    const upsert = jest.fn().mockResolvedValue(undefined);
    const mockModels = mockRefreshDependencies(upsert);
    const connD = conn("sdk-D");

    // First call (inside stale-tracking) fails; the fallback's own bulk-path
    // call to the same function should succeed normally.
    findSDKConnectionsByOrganization
      .mockRejectedValueOnce(new Error("mongo blip"))
      .mockResolvedValue([connD]);

    queueSDKPayloadRefresh({
      context: minimalContext({
        models: mockModels as ReqContext["models"],
      }) as ReqContext,
      payloadKeys: [{ environment: "production", project: "" }],
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(markSdkConnectionsStale).not.toHaveBeenCalled();
    expect(scheduleOrgRefreshJob).not.toHaveBeenCalled();
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith("sdk-D", expect.any(String), undefined);
  });

  it("UI-triggered writes are never tracked as stale, even with tracking enabled", async () => {
    const upsert = jest.fn().mockResolvedValue(undefined);
    const mockModels = mockRefreshDependencies(upsert);
    const connE = conn("sdk-E");
    findSDKConnectionsByOrganization.mockResolvedValue([connE]);

    queueSDKPayloadRefresh({
      context: minimalContext({
        models: mockModels as ReqContext["models"],
        isApiRequest: false,
      }) as ReqContext,
      payloadKeys: [{ environment: "production", project: "" }],
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(markSdkConnectionsStale).not.toHaveBeenCalled();
    expect(scheduleOrgRefreshJob).not.toHaveBeenCalled();
    expect(upsert).toHaveBeenCalledTimes(1);
  });
});

describe("refreshStaleSdkConnectionsForOrg", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (
      global as unknown as { __mockContextModels: unknown }
    ).__mockContextModels = undefined;
  });

  it("does nothing when there are no stale connections", async () => {
    findStaleSdkConnectionsByOrganization.mockResolvedValue([]);

    await refreshStaleSdkConnectionsForOrg(minimalContext() as ReqContext);

    expect(clearStaleSdkConnections).not.toHaveBeenCalled();
  });

  it("rebuilds every stale connection in one pass, then clears staleness for exactly those keys", async () => {
    const upsert = jest.fn().mockResolvedValue(undefined);
    const mockModels = mockRefreshDependencies(upsert);
    const connF = conn("sdk-F");
    const connG = conn("sdk-G");
    findStaleSdkConnectionsByOrganization.mockResolvedValue([connF, connG]);

    await refreshStaleSdkConnectionsForOrg(
      minimalContext({
        models: mockModels as ReqContext["models"],
      }) as ReqContext,
    );

    expect(upsert).toHaveBeenCalledTimes(2);
    expect(clearStaleSdkConnections).toHaveBeenCalledWith(
      "org-1",
      ["sdk-F", "sdk-G"],
      expect.any(Date),
    );
  });
});
