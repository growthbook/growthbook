import { describe, it, expect } from "vitest";
import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import { ExperimentLaunchChecklistInterface } from "shared/types/experimentLaunchChecklist";
import { VisualChangesetInterface } from "shared/types/visual-changeset";
import { SDKConnectionInterface } from "shared/types/sdk-connection";
import { getChecklistItems } from "@/components/PreLaunchChecklist/PreLaunchChecklistItems";

describe("PreLaunchChecklistItems - getChecklistItems", () => {
  const mockExperiment = {
    id: "exp-1",
    phases: [],
    variations: [],
    type: "experiment",
  } as unknown as ExperimentInterfaceStringDates;

  const mockLinkedFeatures: LinkedFeatureInfo[] = [];
  const mockVisualChangesets: VisualChangesetInterface[] = [];
  const mockConnections: SDKConnectionInterface[] = [];

  it("shows default tasks when hideDefaultTasks is false/undefined", () => {
    const items = getChecklistItems({
      experiment: mockExperiment,
      linkedFeatures: mockLinkedFeatures,
      visualChangesets: mockVisualChangesets,
      connections: mockConnections,
      checkLinkedChanges: true,
      checklist: {
        id: "checklist-1",
        tasks: [],
      } as unknown as ExperimentLaunchChecklistInterface,
    });

    // 3 default items: Linked feature add, configure phases, SDK connection
    expect(items.length).toBe(3);
  });

  it("hides default tasks when hideDefaultTasks is true", () => {
    const items = getChecklistItems({
      experiment: mockExperiment,
      linkedFeatures: mockLinkedFeatures,
      visualChangesets: mockVisualChangesets,
      connections: mockConnections,
      checkLinkedChanges: true,
      checklist: {
        id: "checklist-1",
        hideDefaultTasks: true,
        tasks: [],
      } as unknown as ExperimentLaunchChecklistInterface,
    });

    expect(items.length).toBe(0);
  });

  it("still shows custom tasks when hideDefaultTasks is true", () => {
    const items = getChecklistItems({
      experiment: mockExperiment,
      linkedFeatures: mockLinkedFeatures,
      visualChangesets: mockVisualChangesets,
      connections: mockConnections,
      checkLinkedChanges: true,
      checklist: {
        id: "checklist-1",
        hideDefaultTasks: true,
        tasks: [
          {
            task: "Custom task 1",
            completionType: "manual",
          },
        ],
      } as unknown as ExperimentLaunchChecklistInterface,
    });

    expect(items.length).toBe(1);
    // Custom tasks render their task description
    // React fragments get somewhat messy, but the status shouldn't be 'auto' for our mock manual task
    expect(items[0].type).toBe("manual");
  });

  it("still shows hard blockers when hideDefaultTasks is true", () => {
    const items = getChecklistItems({
      experiment: mockExperiment,
      linkedFeatures: [
        {
          feature: { id: "feature-1" },
          state: "draft",
          hasMergeConflict: true,
          values: [],
        } as unknown as LinkedFeatureInfo,
      ],
      visualChangesets: mockVisualChangesets,
      connections: mockConnections,
      checkLinkedChanges: true,
      checklist: {
        id: "checklist-1",
        hideDefaultTasks: true,
        tasks: [],
      } as unknown as ExperimentLaunchChecklistInterface,
    });

    // Hard block items for merge conflicts should always be pushed
    expect(items.length).toBe(1);
    expect(items[0].hardBlock).toBe(true);
  });
});
