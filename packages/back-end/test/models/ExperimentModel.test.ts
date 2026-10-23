import { ExperimentInterface } from "shared/types/experiment";
import { FeatureInterface } from "shared/types/feature";
import {
  ExperimentModel,
  getPayloadKeys,
  hasActualChanges,
  updateExperiment,
} from "back-end/src/models/ExperimentModel";
import { queueSDKPayloadRefresh } from "back-end/src/services/features";
import { ReqContext } from "back-end/types/request";
import {
  connectTestMongo,
  disconnectTestMongo,
} from "back-end/test/test-helpers";

jest.mock("back-end/src/services/experimentNotifications", () => ({
  notifyExperimentStatusTransition: jest.fn(async () => undefined),
  notifyExperimentBanditWeightsTransition: jest.fn(async () => undefined),
}));

// A lazy proxy, not a spread: the module's exports are getters that trip the
// temporal dead zone while its import cycle is still resolving.
jest.mock("back-end/src/services/features", () => {
  const actual = jest.requireActual("back-end/src/services/features");
  const queueSDKPayloadRefreshMock = jest.fn();
  return new Proxy(actual, {
    get: (target, key) =>
      key === "queueSDKPayloadRefresh"
        ? queueSDKPayloadRefreshMock
        : Reflect.get(target, key),
  });
});

const mockQueueSDKPayloadRefresh =
  queueSDKPayloadRefresh as jest.MockedFunction<typeof queueSDKPayloadRefresh>;

describe("ExperimentModel", () => {
  const experiment: ExperimentInterface = {
    id: "exp_123",
    organization: "org_123",
    trackingKey: "my-experiment",
    name: "Test Experiment",
    project: "proj_1",
    hypothesis: "This is a test",
    description: "Test description",
    tags: ["test"],
    owner: "user_123",
    dateCreated: new Date("2024-01-01T00:00:00Z"),
    dateUpdated: new Date("2024-01-01T00:00:00Z"),
    archived: false,
    status: "running",
    autoSnapshots: false,
    hashAttribute: "id",
    hashVersion: 2,
    variations: [
      { id: "0", key: "control", name: "Control", screenshots: [] },
      { id: "1", key: "variation", name: "Variation", screenshots: [] },
    ],
    phases: [],
    datasource: "",
    exposureQueryId: "",
    goalMetrics: [],
    secondaryMetrics: [],
    guardrailMetrics: [],
    decisionFrameworkSettings: {},
    implementation: "code",
    autoAssign: false,
    previewURL: "",
    targetURLRegex: "",
    ideaSource: "",
    releasedVariationId: "",
  };

  describe("getPayloadKeys", () => {
    it("adds a visual editor experiment's linked-feature projects to its own", () => {
      const context = {
        org: { settings: { environments: [{ id: "production" }] } },
      } as unknown as ReqContext;
      const linked = {
        id: "flag_a",
        project: "proj_2",
        environmentSettings: { production: { enabled: true } },
        rules: [
          {
            id: "r1",
            type: "experiment-ref",
            experimentId: experiment.id,
            enabled: true,
            allEnvironments: true,
          },
        ],
      } as unknown as FeatureInterface;
      const keys = getPayloadKeys(
        context,
        {
          ...experiment,
          hasVisualChangesets: true,
          phases: [{ name: "Main" }],
        } as unknown as ExperimentInterface,
        [linked],
      );
      expect(keys.map((k) => k.project).sort()).toEqual([
        "",
        "proj_1",
        "proj_2",
      ]);
    });
  });

  // Features link to a holdout through `feature.holdout`, never through the
  // companion experiment's `linkedFeatures`, so the holdout's own footprint is
  // what a targeting edit has to invalidate.
  describe("updateExperiment on a holdout's companion experiment", () => {
    const holdout = {
      id: "hld_1",
      experimentId: "exp_holdout",
      projects: ["proj_1"],
      environmentSettings: {
        production: { enabled: true },
        dev: { enabled: false },
      },
      linkedFeatures: { flag_a: { id: "flag_a", dateAdded: new Date() } },
      linkedExperiments: {},
    };
    const holdoutExperiment: ExperimentInterface = {
      ...experiment,
      id: "exp_holdout",
      type: "holdout",
      project: "",
      linkedFeatures: undefined,
      excludeFromPayload: true,
      phases: [
        {
          name: "Holdout",
          reason: "",
          dateStarted: new Date("2024-01-01T00:00:00Z"),
          coverage: 0.1,
          condition: `{"country":"US"}`,
          savedGroups: [],
          variationWeights: [0.5, 0.5],
          variations: [
            { id: "0", status: "active" },
            { id: "1", status: "active" },
          ],
        },
      ],
    };
    const getByExperimentId = jest.fn();
    const context = {
      org: {
        id: experiment.organization,
        settings: {
          environments: [{ id: "production" }, { id: "dev" }],
        },
      },
      models: { holdout: { getByExperimentId } },
      getAllProjectIds: async () => ["proj_1"],
    } as unknown as ReqContext;
    const retarget = (exp: ExperimentInterface) =>
      updateExperiment({
        context,
        experiment: exp,
        changes: {
          phases: [{ ...exp.phases[0], condition: `{"country":"CA"}` }],
        },
      });

    beforeEach(() => {
      jest
        .spyOn(ExperimentModel, "updateOne")
        .mockResolvedValue({ matchedCount: 1 } as never);
      getByExperimentId.mockReset().mockResolvedValue(holdout);
      mockQueueSDKPayloadRefresh.mockReset();
    });
    afterEach(() => jest.restoreAllMocks());

    it("refreshes the payloads the running holdout is served in", async () => {
      await retarget(holdoutExperiment);

      expect(mockQueueSDKPayloadRefresh).toHaveBeenCalledTimes(1);
      expect(getByExperimentId).toHaveBeenCalledWith("exp_holdout");
      expect(mockQueueSDKPayloadRefresh.mock.calls[0][0].payloadKeys).toEqual([
        { environment: "production", project: "proj_1" },
      ]);
    });

    it("leaves the payload alone while the holdout is a draft", async () => {
      await retarget({ ...holdoutExperiment, status: "draft" });

      expect(mockQueueSDKPayloadRefresh).not.toHaveBeenCalled();
    });

    it("skips the refresh when the caller refreshes the holdout itself", async () => {
      await updateExperiment({
        context,
        experiment: holdoutExperiment,
        changes: { status: "stopped" },
        bypassWebhooks: true,
      });

      expect(mockQueueSDKPayloadRefresh).not.toHaveBeenCalled();
    });
  });

  describe("hasActualChanges", () => {
    it("should not update if no changes are made", () => {
      const updates: Partial<ExperimentInterface> = {};
      expect(hasActualChanges(experiment, updates)).toEqual(false);
    });

    it("should not update if what it is trying to update is the same as current experiment", () => {
      const updates: Partial<ExperimentInterface> = {
        dateUpdated: new Date(),
        name: "Test Experiment",
        hypothesis: "This is a test",
      };
      expect(hasActualChanges(experiment, updates)).toEqual(false);
    });

    it("should update if changes are made", () => {
      const updates: Partial<ExperimentInterface> = {
        name: "Updated Experiment",
      };
      expect(hasActualChanges(experiment, updates)).toEqual(true);
    });

    it("should handle array changes - same content", () => {
      const updates: Partial<ExperimentInterface> = {
        tags: ["test"], // Same array content
      };
      expect(hasActualChanges(experiment, updates)).toEqual(false);
    });

    it("should detect array changes - different content", () => {
      const updates: Partial<ExperimentInterface> = {
        tags: ["test", "new-tag"], // Different array content
      };
      expect(hasActualChanges(experiment, updates)).toEqual(true);
    });

    it("should ignore dateUpdated in comparison", () => {
      const updates: Partial<ExperimentInterface> = {
        dateUpdated: new Date("2025-01-01T00:00:00Z"), // Different date
      };
      expect(hasActualChanges(experiment, updates)).toEqual(false);
    });

    it("should detect nested object changes", () => {
      const updates: Partial<ExperimentInterface> = {
        variations: [
          { id: "0", key: "control", name: "Updated Control", screenshots: [] },
          { id: "1", key: "variation", name: "Variation", screenshots: [] },
        ],
      };
      expect(hasActualChanges(experiment, updates)).toEqual(true);
    });
  });

  // The Mongoose schema drops fields it does not declare, so a stamp the
  // validator allows must also be declared here or the job falls back to the owner.
  it("persists who staged a scheduled status change", () => {
    const cast = ExperimentModel.castObject({
      nextScheduledStatusUpdate: {
        type: "stop",
        date: new Date(),
        scheduledBy: "u_1",
      },
    });
    expect(cast.nextScheduledStatusUpdate?.scheduledBy).toBe("u_1");
  });

  describe("updateExperiment", () => {
    beforeAll(connectTestMongo);
    afterAll(disconnectTestMongo);

    it("unsets a cleared assignment query identifier rather than keeping it", async () => {
      /** A holdout skips the event log, which needs a full request context. */
      const stored: ExperimentInterface = {
        ...experiment,
        type: "holdout",
        datasource: "ds_1",
        exposureQueryId: "eq_a",
        exposureQueryIdentifierType: "user_id",
      };
      await ExperimentModel.collection.insertOne({ ...stored });

      await updateExperiment({
        context: { org: { id: stored.organization } } as unknown as ReqContext,
        experiment: stored,
        changes: {
          exposureQueryId: "eq_b",
          exposureQueryIdentifierType: undefined,
        },
        bypassWebhooks: true,
      });

      const raw = await ExperimentModel.collection.findOne({ id: stored.id });
      expect(raw).toMatchObject({ exposureQueryId: "eq_b" });
      expect(raw).not.toHaveProperty("exposureQueryIdentifierType");
    });
  });
});
