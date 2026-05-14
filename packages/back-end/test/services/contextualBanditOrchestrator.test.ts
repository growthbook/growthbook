import { runContextualBanditSnapshot } from "back-end/src/services/experiments";
import { getIntegrationFromDatasourceId } from "back-end/src/services/datasource";
import { runContextualBanditStatsEngine } from "back-end/src/services/stats";
import { queueSDKPayloadRefresh } from "back-end/src/services/features";
import { getExperimentById } from "back-end/src/models/ExperimentModel";

jest.mock("back-end/src/services/datasource", () => ({
  getIntegrationFromDatasourceId: jest.fn(),
}));

jest.mock("back-end/src/services/features", () => ({
  queueSDKPayloadRefresh: jest.fn(),
}));

jest.mock("back-end/src/models/ExperimentModel", () => ({
  getExperimentById: jest.fn(),
  getPayloadKeys: jest.fn(() => [{ environment: "production", project: "" }]),
}));

jest.mock("back-end/src/models/FeatureModel", () => ({
  getFeaturesByIds: jest.fn().mockResolvedValue([]),
}));

jest.mock("back-end/src/services/stats", () => {
  const actual = jest.requireActual("back-end/src/services/stats");
  return {
    ...actual,
    runContextualBanditStatsEngine: jest.fn(),
  };
});

describe("runContextualBanditSnapshot", () => {
  const date = new Date("2026-01-01T00:00:00.000Z");
  const experiment = {
    id: "exp_cb",
    organization: "org",
    trackingKey: "exp-cb",
    type: "contextual-bandit",
    datasource: "ds_1",
    exposureQueryId: "user_id",
    queryFilter: "",
    goalMetrics: ["met_1"],
    linkedFeatures: [],
    project: "",
    status: "running",
    hashVersion: 2,
    variations: [
      { id: "0", key: "control", name: "Control", screenshots: [] },
      { id: "1", key: "treatment", name: "Treatment", screenshots: [] },
    ],
    phases: [
      {
        dateStarted: date,
        name: "Main",
        reason: "",
        coverage: 1,
        condition: "{}",
        variationWeights: [0.5, 0.5],
        variations: [
          { id: "0", status: "active" },
          { id: "1", status: "active" },
        ],
      },
    ],
  };
  const cb = {
    id: "cb_1",
    experiment: "exp_cb",
    cbaqId: "cbaq_1",
    contextualAttributes: ["country"],
    maxContexts: 2,
    treeModel: "regression_tree",
    minUsersPerLeaf: 10,
    maxLeaves: 4,
    holdoutPercent: 0,
    stickyBucketing: false,
    canonicalFormVersion: "v1",
    phases: [{ phase: 0, seed: 123, currentLeafWeights: [] }],
  };
  const cbaq = {
    id: "cbaq_1",
    datasource: "ds_1",
    userIdType: "user_id",
    query: "select * from cb_assignments",
    attributes: [{ attribute: "country", kind: "categorical" }],
  };

  function makeContext() {
    const calls: string[] = [];
    const snapshotModel = {
      dangerousCreateBypassPermission: jest.fn(async (doc) => {
        calls.push(`cbs:${doc.status}`);
        return { id: "cbs_1", ...doc };
      }),
      dangerousUpdateBypassPermission: jest.fn(async (existing, updates) => {
        calls.push(
          `cbs:${updates.status ?? updates.queries?.[0]?.status ?? "patch"}`,
        );
        return { ...existing, ...updates };
      }),
    };
    const eventModel = {
      getLatestForExperimentPhase: jest.fn().mockResolvedValue(null),
      dangerousCreateBypassPermission: jest.fn(async (doc) => {
        calls.push("cbe:create");
        return { id: "cbe_1", ...doc };
      }),
    };
    const banditModel = {
      getByExperimentId: jest.fn().mockResolvedValue(cb),
      patchPhaseWeights: jest.fn(async () => {
        calls.push("cb:patch");
        return cb;
      }),
    };

    return {
      calls,
      context: {
        org: { id: "org", settings: { environments: [] } },
        userId: "user_1",
        models: {
          contextualBandits: banditModel,
          contextualBanditQueries: {
            getByIdInOrg: jest.fn().mockResolvedValue(cbaq),
          },
          contextualBanditEvents: eventModel,
          contextualBanditSnapshots: snapshotModel,
        },
      },
      snapshotModel,
      eventModel,
      banditModel,
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    (getExperimentById as jest.Mock).mockResolvedValue(experiment);
    (getIntegrationFromDatasourceId as jest.Mock).mockResolvedValue({
      getContextualBanditDimensionSql: jest.fn(() => "select 1"),
      runContextualBanditDimensionQuery: jest.fn().mockResolvedValue({
        rows: [
          {
            variation: "0",
            context_id: "country=US",
            main_sum: 10,
            main_sum_squares: 20,
            n: 10,
          },
          {
            variation: "1",
            context_id: "country=US",
            main_sum: 15,
            main_sum_squares: 30,
            n: 10,
          },
        ],
      }),
    });
    (runContextualBanditStatsEngine as jest.Mock).mockResolvedValue({
      result: [
        {
          contextID: "country=US",
          currentWeights: [0.5, 0.5],
          updatedWeights: [0.4, 0.6],
          weightsWereUpdated: true,
          seed: 124,
        },
      ],
      tree_summary: {
        leaves: [
          {
            leaf_id: "leaf_1",
            condition: { country: "US" },
            context_ids: ["country=US"],
            weights: [0.4, 0.6],
          },
        ],
        split_features: ["country"],
      },
      update_message: "ok",
      error: null,
    });
  });

  it("orders CBS, SQL, CBE, CB patch, SDK refresh, and success side effects", async () => {
    const { context, calls, banditModel } = makeContext();

    const result = await runContextualBanditSnapshot(
      context as never,
      "exp_cb",
    );

    expect(result).toEqual({ snapshotId: "cbs_1", cbeId: "cbe_1" });
    expect(calls).toEqual([
      "cbs:pending",
      "cbs:running",
      "cbs:running",
      "cbs:succeeded",
      "cbe:create",
      "cb:patch",
      "cbs:success",
    ]);
    expect(banditModel.patchPhaseWeights).toHaveBeenCalledWith(
      "exp_cb",
      0,
      expect.arrayContaining([
        expect.objectContaining({
          condition: { country: "US" },
          weights: [0.4, 0.6],
        }),
      ]),
      "cbe_1",
      124,
    );
    expect(queueSDKPayloadRefresh).toHaveBeenCalled();
  });

  it("closes the CBS with error and does not write CBE on warehouse failure", async () => {
    const { context, calls, eventModel } = makeContext();
    (getIntegrationFromDatasourceId as jest.Mock).mockResolvedValue({
      getContextualBanditDimensionSql: jest.fn(() => "select bad_column"),
      runContextualBanditDimensionQuery: jest
        .fn()
        .mockRejectedValue(new Error("column does not exist")),
    });

    const result = await runContextualBanditSnapshot(
      context as never,
      "exp_cb",
    );

    expect(result).toEqual({ snapshotId: "cbs_1" });
    expect(calls).toContain("cbs:error");
    expect(eventModel.dangerousCreateBypassPermission).not.toHaveBeenCalled();
  });
});
