import { ExperimentInterface } from "shared/types/experiment";
import { FeatureInterface } from "shared/types/feature";
import {
  ExperimentModel,
  getPayloadKeys,
  hasActualChanges,
  updateExperiment,
} from "back-end/src/models/ExperimentModel";
import { ReqContext } from "back-end/types/request";
import {
  connectTestMongo,
  disconnectTestMongo,
} from "back-end/test/test-helpers";

jest.mock("back-end/src/services/experimentNotifications", () => ({
  notifyExperimentStatusTransition: jest.fn(async () => undefined),
  notifyExperimentBanditWeightsTransition: jest.fn(async () => undefined),
}));

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
