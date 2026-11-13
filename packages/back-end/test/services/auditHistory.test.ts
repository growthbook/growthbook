import type { ReqContext } from "back-end/types/request";
import { getAuditHistoryExcludeIds } from "back-end/src/services/auditHistory";
import { getFeature } from "back-end/src/models/FeatureModel";
import { getMetricById } from "back-end/src/models/MetricModel";
import {
  canReadApiKeyHistory,
  getApiKeyIdsHiddenFromKeyViewers,
} from "back-end/src/services/apiKeyHistory";

jest.mock("back-end/src/models/FeatureModel", () => ({
  getFeature: jest.fn(),
}));
jest.mock("back-end/src/models/ExperimentModel", () => ({
  getExperimentById: jest.fn(),
}));
jest.mock("back-end/src/models/MetricModel", () => ({
  getMetricById: jest.fn(),
}));
jest.mock("back-end/src/models/FactTableModel", () => ({
  getFactTable: jest.fn(),
}));
jest.mock("back-end/src/models/DataSourceModel", () => ({
  getDataSourceById: jest.fn(),
}));
jest.mock("back-end/src/services/apiKeyHistory", () => ({
  canReadApiKeyHistory: jest.fn(),
  getApiKeyIdsHiddenFromKeyViewers: jest.fn(),
}));

const mockedGetFeature = jest.mocked(getFeature);
const mockedGetMetric = jest.mocked(getMetricById);
const mockedCanReadKey = jest.mocked(canReadApiKeyHistory);
const mockedHiddenKeys = jest.mocked(getApiKeyIdsHiddenFromKeyViewers);

const denied = new Error("denied");

function makeContext({
  viewAuditLogs = false,
  manageTokens = false,
  readableProjects = [] as string[],
  readableFactMetrics = [] as string[],
} = {}) {
  return {
    permissions: {
      canViewAuditLogs: () => viewAuditLogs,
      canManagePersonalAccessTokens: () => manageTokens,
      canReadSingleProjectResource: (p: string) => readableProjects.includes(p),
      throwPermissionError: () => {
        throw denied;
      },
    },
    getAllProjectIds: async () => ["prj_a", "prj_b"],
    models: {
      factMetrics: {
        getById: async (id: string) =>
          readableFactMetrics.includes(id) ? { id } : null,
      },
    },
  } as unknown as ReqContext;
}

const member = makeContext({ readableProjects: ["prj_a"] });
const auditor = makeContext({ viewAuditLogs: true });

beforeEach(() => {
  jest.resetAllMocks();
});

describe("getAuditHistoryExcludeIds", () => {
  it("lets a user read the history of an entity they can read", async () => {
    mockedGetFeature.mockResolvedValue({ id: "feat_1" } as never);
    await expect(
      getAuditHistoryExcludeIds(member, "feature", "feat_1"),
    ).resolves.toEqual([]);
    expect(mockedGetFeature).toHaveBeenCalledWith(member, "feat_1");
  });

  it("needs the audit log permission for an unreadable or deleted entity", async () => {
    mockedGetFeature.mockResolvedValue(null);
    await expect(
      getAuditHistoryExcludeIds(member, "feature", "feat_1"),
    ).rejects.toBe(denied);
    await expect(
      getAuditHistoryExcludeIds(auditor, "feature", "feat_1"),
    ).resolves.toEqual([]);
  });

  it("routes fact metric ids to the fact metric model", async () => {
    const ctx = makeContext({ readableFactMetrics: ["fact__1"] });
    await expect(
      getAuditHistoryExcludeIds(ctx, "metric", "fact__1"),
    ).resolves.toEqual([]);
    expect(mockedGetMetric).not.toHaveBeenCalled();
  });

  it("needs the audit log permission for a type-wide list", async () => {
    await expect(
      getAuditHistoryExcludeIds(member, "feature", undefined),
    ).rejects.toBe(denied);
    expect(mockedGetFeature).not.toHaveBeenCalled();
    await expect(
      getAuditHistoryExcludeIds(auditor, "feature", undefined),
    ).resolves.toEqual([]);
  });

  it("needs the audit log permission for entities with no project scope", async () => {
    await expect(
      getAuditHistoryExcludeIds(member, "team", "team_1"),
    ).rejects.toBe(denied);
    await expect(
      getAuditHistoryExcludeIds(auditor, "team", "team_1"),
    ).resolves.toEqual([]);
  });

  it("scopes Project history to readable Projects", async () => {
    await expect(
      getAuditHistoryExcludeIds(member, "project", undefined),
    ).resolves.toEqual(["prj_b"]);
    await expect(
      getAuditHistoryExcludeIds(member, "project", "prj_a"),
    ).resolves.toEqual([]);
    await expect(
      getAuditHistoryExcludeIds(member, "project", "prj_b"),
    ).rejects.toBe(denied);
  });

  it("keeps the API key read rules", async () => {
    mockedCanReadKey.mockResolvedValue(false);
    await expect(
      getAuditHistoryExcludeIds(auditor, "apiKey", "key_1"),
    ).rejects.toBe(denied);

    mockedCanReadKey.mockResolvedValue(true);
    mockedHiddenKeys.mockResolvedValue(["key_token"]);
    await expect(
      getAuditHistoryExcludeIds(member, "apiKey", undefined),
    ).resolves.toEqual(["key_token"]);
    const manager = makeContext({ manageTokens: true });
    await expect(
      getAuditHistoryExcludeIds(manager, "apiKey", undefined),
    ).resolves.toEqual([]);
  });
});
