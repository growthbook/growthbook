import { hasActualChanges } from "back-end/src/models/ExperimentModel";
import { ExperimentInterface } from "back-end/types/experiment";

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
});
