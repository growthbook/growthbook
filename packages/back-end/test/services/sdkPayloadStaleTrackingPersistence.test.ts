/**
 * Exercises queueSDKPayloadRefresh / refreshStaleSdkConnectionsForOrg (both
 * services/features.ts exports) against a REAL, unmocked SDKConnectionModel
 * backed by mongodb-memory-server — per repo testing policy (utility/service
 * functions, not models), the subject under test here is the service layer,
 * but leaving the model unmocked lets the actual staleSince persistence
 * semantics (always bump, guarded clear) get verified against a real
 * database rather than a mock that could silently drift from reality.
 */
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
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

const scheduleOrgRefreshJobMock = jest.fn().mockResolvedValue(undefined);
jest.mock("back-end/src/jobs/refreshStaleSdkConnections", () => ({
  scheduleOrgRefreshJob: (...args: unknown[]) =>
    scheduleOrgRefreshJobMock(...args),
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
    permissions: { canReadMultiProjectResource: () => true },
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
    permissions: { canReadMultiProjectResource: () => true },
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

describe("SDK payload stale tracking persistence (real SDKConnectionModel)", () => {
  let mongod: MongoMemoryServer;

  const rawCollection = () =>
    mongoose.connection.db!.collection("sdkconnections");

  const insertConnection = async (overrides: {
    id: string;
    key: string;
    staleSince?: Date | null;
    environment?: string;
  }) => {
    await rawCollection().insertOne({
      organization: "org-1",
      id: overrides.id,
      key: overrides.key,
      name: "Conn",
      environment: overrides.environment ?? "production",
      projects: [],
      dateCreated: new Date(),
      dateUpdated: new Date(),
      ...(overrides.staleSince !== undefined
        ? { staleSince: overrides.staleSince }
        : {}),
    });
  };

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.connection.close();
    await mongod.stop();
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    (
      global as unknown as { __mockContextModels: unknown }
    ).__mockContextModels = undefined;
    await rawCollection().deleteMany({});
  });

  it("marks the affected connection stale on a REST write", async () => {
    await insertConnection({ id: "c1", key: "sdk-1" });
    const mockModels = mockRefreshDependencies(jest.fn());

    queueSDKPayloadRefresh({
      context: minimalContext({
        models: mockModels as ReqContext["models"],
      }) as ReqContext,
      payloadKeys: [{ environment: "production", project: "" }],
    });
    await new Promise((r) => setTimeout(r, 50));

    const doc = await rawCollection().findOne({ key: "sdk-1" });
    expect(doc?.staleSince).toBeInstanceOf(Date);
    expect(scheduleOrgRefreshJobMock).toHaveBeenCalledWith("org-1");
  });

  it("bumps staleSince again on a second write even though the connection is already stale", async () => {
    const original = new Date(Date.now() - 60_000);
    await insertConnection({ id: "c1", key: "sdk-1", staleSince: original });
    const mockModels = mockRefreshDependencies(jest.fn());

    queueSDKPayloadRefresh({
      context: minimalContext({
        models: mockModels as ReqContext["models"],
      }) as ReqContext,
      payloadKeys: [{ environment: "production", project: "" }],
    });
    await new Promise((r) => setTimeout(r, 50));

    const doc = await rawCollection().findOne({ key: "sdk-1" });
    // Must advance, not stay pinned to the earlier mark — otherwise a
    // concurrent rebuild's guarded clear (staleSince <= readStartedAt) can't
    // distinguish this write from the one it's about to clear, and the
    // write's effect is silently dropped.
    expect(doc?.staleSince.getTime()).toBeGreaterThan(original.getTime());
    expect(scheduleOrgRefreshJobMock).toHaveBeenCalledWith("org-1");
  });

  it("refreshStaleSdkConnectionsForOrg rebuilds stale connections and clears their marker", async () => {
    await insertConnection({
      id: "c1",
      key: "sdk-1",
      staleSince: new Date(),
    });
    await insertConnection({
      id: "c2",
      key: "sdk-2",
      staleSince: new Date(),
    });
    const upsert = jest.fn().mockResolvedValue(undefined);
    const mockModels = mockRefreshDependencies(upsert);

    await refreshStaleSdkConnectionsForOrg(
      minimalContext({
        models: mockModels as ReqContext["models"],
      }) as ReqContext,
    );

    expect(upsert).toHaveBeenCalledTimes(2);
    const docs = await rawCollection()
      .find({ organization: "org-1" })
      .toArray();
    docs.forEach((d) => expect(d.staleSince).toBeNull());
  });

  it("a connection re-marked stale while its refresh is in flight survives the completion clear", async () => {
    const original = new Date(Date.now() - 60_000);
    await insertConnection({ id: "c1", key: "sdk-race", staleSince: original });

    // The upsert call happens between refreshStaleSdkConnectionsForOrg's read
    // of stale connections and its guarded clear — simulate a concurrent
    // write landing in that window.
    const upsert = jest.fn().mockImplementation(async () => {
      await rawCollection().updateOne(
        { key: "sdk-race" },
        { $set: { staleSince: new Date() } },
      );
    });
    const mockModels = mockRefreshDependencies(upsert);

    await refreshStaleSdkConnectionsForOrg(
      minimalContext({
        models: mockModels as ReqContext["models"],
      }) as ReqContext,
    );

    const doc = await rawCollection().findOne({ key: "sdk-race" });
    expect(doc?.staleSince).toBeInstanceOf(Date);
  });

  it("clears the marker itself when job scheduling fails and it falls back to a direct refresh", async () => {
    await insertConnection({ id: "c1", key: "sdk-fallback" });
    const upsert = jest.fn().mockResolvedValue(undefined);
    const mockModels = mockRefreshDependencies(upsert);
    scheduleOrgRefreshJobMock.mockRejectedValueOnce(new Error("agenda down"));

    queueSDKPayloadRefresh({
      context: minimalContext({
        models: mockModels as ReqContext["models"],
      }) as ReqContext,
      payloadKeys: [{ environment: "production", project: "" }],
    });
    await new Promise((r) => setTimeout(r, 50));

    expect(upsert).toHaveBeenCalledWith(
      "sdk-fallback",
      expect.any(String),
      undefined,
    );
    const doc = await rawCollection().findOne({ key: "sdk-fallback" });
    expect(doc?.staleSince).toBeNull();
  });
});
