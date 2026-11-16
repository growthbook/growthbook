import type {
  ExperimentInterface,
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import type { ChecklistTask } from "shared/types/experimentLaunchChecklist";
import type { VisualChange } from "shared/types/visual-changeset";
import {
  experimentHasLiveLinkedChanges,
  hasPendingScheduledStart,
  hasVisualChanges,
  linkedDraftApproved,
} from "../util";
import {
  type BuiltInChecklistItemKey,
  getHiddenBuiltInChecklistItems,
  PENDING_APPROVAL_ITEM_PREFIX,
} from "../validators/experiment-launch-checklist";
import { getLatestPhaseVariations } from "./variations";
import { areVariationWeightsValid } from "./experiments";

export type LaunchChecklistItem = {
  // A built-in key, `<kind>:<featureId>` for a linked flag, or a custom task.
  key: string;
  // One action that resolves it.
  label: string;
  status: "complete" | "incomplete";
  required: boolean;
  // Blocks a start outright: only the approval rows can be waived, by bypass.
  hardBlock: boolean;
  manual: boolean;
  featureId?: string;
  // The flag revision the row is about, when not its launch draft; null for
  // the flag itself.
  revision?: number | null;
  // A custom task, by its place in the configured checklist.
  customTask?: { index: number; url?: string; propertyKey?: string };
};

type ChecklistExperiment = ExperimentInterface | ExperimentInterfaceStringDates;

const complete = (done: boolean): LaunchChecklistItem["status"] =>
  done ? "complete" : "incomplete";

export function sdkConnectionServesProject(
  connection: { projects?: string[] },
  project: string | undefined,
): boolean {
  return (
    !connection.projects?.length || connection.projects.includes(project || "")
  );
}

function flagItem(
  f: LinkedFeatureInfo,
  prefix: string,
  label: string,
  rest: Partial<LaunchChecklistItem> = {},
): LaunchChecklistItem {
  return {
    key: `${prefix}${f.feature.id}`,
    label,
    status: "incomplete",
    required: true,
    hardBlock: true,
    manual: false,
    featureId: f.feature.id,
    ...rest,
  };
}

export function mergeConflictItems(
  linkedFeatures: LinkedFeatureInfo[],
): LaunchChecklistItem[] {
  return linkedFeatures
    .filter((f) => f.state === "draft" && f.hasMergeConflict)
    .map((f) =>
      flagItem(
        f,
        "mergeConflict:",
        `Resolve the merge conflict in ${f.feature.id}`,
      ),
    );
}

// The draft being published is exempt: its own publish takes the extra edits.
export function unrelatedDraftChangeItems(
  linkedFeatures: LinkedFeatureInfo[],
  publishingFeatureId?: string,
): LaunchChecklistItem[] {
  return linkedFeatures
    .filter(
      (f) =>
        f.state === "draft" &&
        f.hasUnrelatedDraftChanges &&
        !f.hasMergeConflict &&
        f.feature.id !== publishingFeatureId,
    )
    .map((f) =>
      flagItem(
        f,
        "unrelatedDraftChanges:",
        `Publish the ${f.feature.id} draft, or remove its unrelated changes`,
      ),
    );
}

export function missingVariationValueItems(
  linkedFeatures: LinkedFeatureInfo[],
  variations: { id: string }[],
): LaunchChecklistItem[] {
  return linkedFeatures
    .filter((f) => {
      if (f.state === "discarded" || f.state === "archived") return false;
      const configured = new Set(f.values.map((v) => v.variationId));
      return variations.some((v) => !configured.has(v.id));
    })
    .map((f) =>
      flagItem(
        f,
        "missingVariationValues:",
        `Fill in missing variation values for ${f.feature.id}`,
        { hardBlock: false, revision: null },
      ),
    );
}

function isTaskComplete(
  experiment: ChecklistExperiment,
  task: ChecklistTask,
): boolean {
  const manuallyComplete = (key: string) =>
    experiment.manualLaunchChecklist?.find((t) => t.key === key)?.status ===
    "complete";
  if (task.completionType === "manual") return manuallyComplete(task.task);
  switch (task.propertyKey) {
    case "hypothesis":
      return !!experiment.hypothesis;
    case "screenshots":
      return getLatestPhaseVariations(experiment).every(
        (v) => !!v.screenshots.length,
      );
    case "description":
      return !!experiment.description;
    case "project":
      return !!experiment.project;
    case "tag":
      return (experiment.tags?.length ?? 0) > 0;
    case "customField":
      return task.customFieldId
        ? !!experiment.customFields?.[task.customFieldId]
        : false;
    case "prerequisiteTargeting":
      return !!experiment.phases.at(-1)?.prerequisites?.length;
    case "schedule":
      return !!experiment.statusUpdateSchedule?.startAt;
    case undefined:
      return false;
  }
}

/** What an experiment's start checks, for both the app and the REST API. */
export function getLaunchChecklistItems({
  experiment,
  linkedFeatures,
  visualChangesets,
  urlRedirects,
  sdkConnections,
  checklist,
  publishingFeatureId,
}: {
  experiment: ChecklistExperiment;
  linkedFeatures: LinkedFeatureInfo[];
  visualChangesets: { visualChanges: VisualChange[] }[];
  urlRedirects: unknown[];
  // The ones that serve the experiment's Project.
  sdkConnections: {
    includeVisualExperiments?: boolean;
    includeRedirectExperiments?: boolean;
  }[];
  checklist?: {
    tasks?: ChecklistTask[];
    hiddenBuiltInItems?: BuiltInChecklistItemKey[];
  } | null;
  // Publishing this flag's draft is what starts the experiment.
  publishingFeatureId?: string;
}): LaunchChecklistItem[] {
  const isBandit = experiment.type === "multi-armed-bandit";
  const items: LaunchChecklistItem[] = [];
  const hidden = getHiddenBuiltInChecklistItems(checklist, experiment);
  const pushBuiltIn = (
    key: BuiltInChecklistItemKey,
    item: Omit<LaunchChecklistItem, "key" | "required" | "manual">,
  ) => {
    if (!hidden.has(key)) {
      items.push({ key, required: true, manual: false, ...item });
    }
  };

  if (!isBandit) {
    pushBuiltIn("datasource", {
      label: "Select a Data Source",
      status: complete(!!experiment.datasource),
      hardBlock: false,
    });
    pushBuiltIn("exposureQuery", {
      label: "Select an experiment assignment table",
      status: complete(!!experiment.exposureQueryId),
      hardBlock: false,
    });
    if (experiment.datasource && experiment.exposureQueryId) {
      pushBuiltIn("goalMetric", {
        label: "Add at least one goal metric",
        status: complete(!!experiment.goalMetrics?.length),
        hardBlock: false,
      });
    }
  }

  const publishesLinkedFeature =
    !!publishingFeatureId &&
    linkedFeatures.some(
      (f) => f.feature.id === publishingFeatureId && f.state === "draft",
    );
  const linkedChangesDone = isBandit
    ? experimentHasLiveLinkedChanges(experiment, linkedFeatures) ||
      publishesLinkedFeature
    : linkedFeatures.some((f) => f.state === "live" || f.state === "draft") ||
      !!experiment.hasVisualChangesets ||
      !!experiment.hasURLRedirects;
  pushBuiltIn("linkedChanges", {
    label: `Add a${isBandit ? " live" : ""} linked Feature Flag, AI Visual Editor change, or URL redirect`,
    status: complete(linkedChangesDone),
    // A Bandit can't start without one; publishing a flag is how it gets one.
    hardBlock: isBandit && !publishingFeatureId,
  });

  if (isBandit) {
    items.push({
      key: "banditGoalMetric",
      label: "Choose a decision metric and update cadence",
      status: complete(!!experiment.goalMetrics?.[0]),
      required: true,
      hardBlock: false,
      manual: false,
    });
  }

  const armed = hasPendingScheduledStart(experiment);
  items.push(
    ...mergeConflictItems(linkedFeatures),
    // A start publishes only drafts with the rule, so the live rule would serve.
    ...linkedFeatures.flatMap((f) =>
      f.pendingRemoval
        ? [
            flagItem(
              f,
              "pendingRemoval:",
              `Publish Revision ${f.pendingRemoval.version} of ${f.feature.id} to unlink it, or keep it linked`,
              { revision: f.pendingRemoval.version },
            ),
          ]
        : [],
    ),
    ...linkedFeatures
      .filter((f) => f.state === "draft" && f.cannotPublish)
      .map((f) =>
        flagItem(
          f,
          "publishPermission:",
          armed
            ? `Reschedule the start as someone who can publish ${f.feature.id}`
            : `Have someone who can publish ${f.feature.id} start this ${isBandit ? "Bandit" : "experiment"}`,
        ),
      ),
    // Publishing a flag's own draft is what approves it.
    ...linkedFeatures
      .filter(
        (f) =>
          f.pendingApproval &&
          !f.hasUnrelatedDraftChanges &&
          f.feature.id !== publishingFeatureId,
      )
      .map((f) => ({
        ...flagItem(
          f,
          PENDING_APPROVAL_ITEM_PREFIX,
          `Approve the Feature Flag draft for ${f.feature.id}`,
        ),
        status: complete(linkedDraftApproved(f)),
      })),
    ...unrelatedDraftChangeItems(linkedFeatures, publishingFeatureId),
    ...missingVariationValueItems(
      linkedFeatures,
      getLatestPhaseVariations(experiment),
    ),
  );

  const hasAnyVisualChanges = visualChangesets.some((vc) =>
    hasVisualChanges(vc.visualChanges),
  );
  if (visualChangesets.length > 0) {
    // An A/A test needs no changes.
    items.push({
      key: "visualEditorChanges",
      label: "Add changes in the AI Visual Editor",
      status: complete(hasAnyVisualChanges),
      required: false,
      hardBlock: false,
      manual: false,
    });
  }

  const hasPhases = experiment.phases.length > 0;
  pushBuiltIn("targeting", {
    label: "Configure variation assignment and targeting",
    status: complete(hasPhases),
    // There's no phase to run.
    hardBlock: !hasPhases,
  });
  const weights =
    experiment.phases[experiment.phases.length - 1]?.variationWeights;
  // Can't be hidden: SDKs would serve an equal split. A Bandit's start resets
  // its weights.
  if (!isBandit && weights && !areVariationWeightsValid(weights)) {
    items.push({
      key: "variationWeights",
      label: "Fix the variation weights so they add up to 100%",
      status: "incomplete",
      required: true,
      hardBlock: true,
      manual: false,
    });
  }

  pushBuiltIn("sdkConnection", {
    label: "Add an SDK Connection",
    status: complete(sdkConnections.length > 0),
    hardBlock: false,
  });

  if (hasAnyVisualChanges) {
    items.push({
      key: "visualEditorSdk",
      label:
        "Enable Visual Editor experiments on an SDK Connection for this Project",
      status: complete(sdkConnections.some((c) => c.includeVisualExperiments)),
      required: true,
      hardBlock: false,
      manual: false,
    });
  }
  if (urlRedirects.length > 0) {
    items.push({
      key: "urlRedirectSdk",
      label:
        "Enable URL redirect experiments on an SDK Connection for this Project",
      status: complete(
        sdkConnections.some((c) => c.includeRedirectExperiments),
      ),
      required: true,
      hardBlock: false,
      manual: false,
    });
  }

  checklist?.tasks?.forEach((task, index) => {
    const manual = task.completionType === "manual";
    if (!manual && !task.propertyKey) return;
    // Bandits have no hypothesis and never schedule a start.
    if (
      isBandit &&
      (task.propertyKey === "hypothesis" || task.propertyKey === "schedule")
    ) {
      return;
    }
    items.push({
      key: task.task,
      label:
        !manual && task.propertyKey === "schedule"
          ? "Add a scheduled start date"
          : task.task,
      status: complete(isTaskComplete(experiment, task)),
      required: true,
      hardBlock: false,
      manual,
      customTask: { index, url: task.url, propertyKey: task.propertyKey },
    });
  });

  return items;
}
