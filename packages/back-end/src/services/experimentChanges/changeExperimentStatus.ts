import { getLatestPhaseVariations, getAllVariations } from "shared/experiments";
import { getValidDate } from "shared/dates";
import {
  ExperimentInterface,
  LinkedFeatureInfo,
  Changeset,
  ExperimentResultsType,
} from "shared/types/experiment";
import { getAffectedEnvsForExperiment, experimentHasLiveLinkedChanges } from "shared/util";
import { orgHasPremiumFeature } from "back-end/src/enterprise";
import { getExperimentLaunchChecklist } from "back-end/src/models/ExperimentLaunchChecklistModel";
import {
  getExperimentById,
  updateExperiment,
} from "back-end/src/models/ExperimentModel";
import { getFeaturesByIds } from "back-end/src/models/FeatureModel";
import { findSDKConnectionsByOrganization } from "back-end/src/models/SdkConnectionModel";
import { ReqContext } from "back-end/types/request";
import { getChangesToStartExperiment, getLinkedFeatureInfo } from "../experiments";

type ChecklistStatus = "complete" | "incomplete";

export type StartChecklistItemStatus = {
  key: string;
  required: boolean;
  status: ChecklistStatus;
  reason: string;
};

export type StopExperimentInput = {
  experimentId: string;
  results: ExperimentResultsType;
  winnerVariationId?: string;
  winner?: number;
  releasedVariationId?: string;
  enableTemporaryRollout?: boolean;
  excludeFromPayload?: boolean;
  reason?: string;
  analysis?: string;
  dateEnded?: string;
};

function getHasLinkedChanges(
  experiment: ExperimentInterface,
  linkedFeatures: LinkedFeatureInfo[],
): boolean {
  return !!(
    linkedFeatures.some((f) => f.state === "live" || f.state === "draft") ||
    experiment.hasVisualChangesets ||
    experiment.hasURLRedirects
  );
}

function isCustomTaskComplete(
  experiment: ExperimentInterface,
  key: string,
  customFieldId?: string,
): boolean {
  const manualChecklistStatus = experiment.manualLaunchChecklist || [];
  const item = manualChecklistStatus.find((task) => task.key === key);

  switch (key) {
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
      return customFieldId ? !!experiment.customFields?.[customFieldId] : false;
    case "prerequisiteTargeting": {
      const prerequisites =
        experiment.phases?.[experiment.phases.length - 1]?.prerequisites;
      return !!prerequisites && prerequisites.length > 0;
    }
    default:
      break;
  }

  return item?.status === "complete";
}

export async function getExperimentStartChecklistStatus(
  context: ReqContext,
  experiment: ExperimentInterface,
): Promise<StartChecklistItemStatus[]> {
  const linkedFeatures = await getLinkedFeatureInfo(context, experiment);
  const sdkConnections = await findSDKConnectionsByOrganization(context);
  const isBandit = experiment.type === "multi-armed-bandit";

  const items: StartChecklistItemStatus[] = [];

  items.push({
    key: "linkedChanges",
    required: true,
    status:
      (isBandit &&
        experimentHasLiveLinkedChanges(experiment, linkedFeatures)) ||
      (!isBandit && getHasLinkedChanges(experiment, linkedFeatures))
        ? "complete"
        : "incomplete",
    reason: isBandit
      ? "Add at least one live linked change before starting a bandit."
      : "Add at least one linked feature, visual changeset, or URL redirect before starting.",
  });

  if (isBandit) {
    items.push({
      key: "banditGoalMetric",
      required: true,
      status: experiment.goalMetrics?.[0] ? "complete" : "incomplete",
      reason: "Bandits require a goal metric before starting.",
    });
  }

  items.push({
    key: "targeting",
    required: true,
    status: experiment.phases.length > 0 ? "complete" : "incomplete",
    reason: "Configure at least one phase with assignment/targeting settings.",
  });

  items.push({
    key: "sdkConnection",
    required: true,
    status: sdkConnections.length > 0 ? "complete" : "incomplete",
    reason: "Add an SDK connection before starting.",
  });

  if (orgHasPremiumFeature(context.org, "custom-launch-checklist")) {
    const checklist =
      (experiment.project &&
        (await getExperimentLaunchChecklist(context.org.id, experiment.project))) ||
      (await getExperimentLaunchChecklist(context.org.id, ""));

    checklist?.tasks?.forEach((task) => {
      if (task.completionType === "auto" && task.propertyKey) {
        if (isBandit && task.propertyKey === "hypothesis") return;
        items.push({
          key: task.task,
          required: true,
          status: isCustomTaskComplete(
            experiment,
            task.propertyKey,
            task.customFieldId,
          )
            ? "complete"
            : "incomplete",
          reason: `Required custom launch checklist item is incomplete: ${task.task}`,
        });
      } else if (task.completionType === "manual") {
        items.push({
          key: task.task,
          required: true,
          status: isCustomTaskComplete(experiment, task.task)
            ? "complete"
            : "incomplete",
          reason: `Required custom launch checklist item is incomplete: ${task.task}`,
        });
      }
    });
  }

  return items;
}

async function loadAndValidateExperimentForStatusChange(
  context: ReqContext,
  experimentId: string,
) {
  const experiment = await getExperimentById(context, experimentId);
  if (!experiment) {
    throw new Error("Could not find experiment");
  }
  if (experiment.organization !== context.org.id) {
    throw new Error("You do not have access to this experiment");
  }
  if (experiment.type === "holdout") {
    throw new Error("Holdouts are not supported through this endpoint");
  }

  if (!context.permissions.canUpdateExperiment(experiment, {})) {
    context.permissions.throwPermissionError();
  }

  const linkedFeatures = await getFeaturesByIds(context, experiment.linkedFeatures || []);
  const envs = getAffectedEnvsForExperiment({
    experiment,
    orgEnvironments: context.org.settings?.environments || [],
    linkedFeatures,
  });

  if (envs.length > 0 && !context.permissions.canRunExperiment(experiment, envs)) {
    context.permissions.throwPermissionError();
  }

  return experiment;
}

export async function startExperiment({
  context,
  experimentId,
  skipChecklist = false,
}: {
  context: ReqContext;
  experimentId: string;
  skipChecklist?: boolean;
}) {
  const experiment = await loadAndValidateExperimentForStatusChange(
    context,
    experimentId,
  );

  if (experiment.status !== "draft") {
    throw new Error("invalid_status: Experiment must be in draft status");
  }

  const checklistItems = await getExperimentStartChecklistStatus(
    context,
    experiment,
  );
  const incompleteRequiredItems = checklistItems.filter(
    (item) => item.required && item.status === "incomplete",
  );
  if (incompleteRequiredItems.length > 0 && !skipChecklist) {
    throw new Error(
      `checklist_incomplete: ${incompleteRequiredItems
        .map((i) => i.key)
        .join(", ")}`,
    );
  }

  const changes = await getChangesToStartExperiment(context, experiment);
  changes.status = "running";

  const updated = await updateExperiment({
    context,
    experiment,
    changes,
  });

  return { experiment, updated, checklistItems };
}

export async function stopExperiment({
  context,
  input,
}: {
  context: ReqContext;
  input: StopExperimentInput;
}) {
  const experiment = await loadAndValidateExperimentForStatusChange(
    context,
    input.experimentId,
  );

  if (experiment.status === "draft") {
    throw new Error("invalid_status: Cannot stop an experiment in draft status");
  }
  if (input.dateEnded && Number.isNaN(new Date(input.dateEnded).getTime())) {
    throw new Error("invalid_dateEnded: dateEnded must be an ISO datetime");
  }

  const variations = getAllVariations(experiment);
  const winnerIndexFromId = input.winnerVariationId
    ? variations.findIndex((v) => v.id === input.winnerVariationId)
    : -1;
  const winnerIndex =
    winnerIndexFromId >= 0
      ? winnerIndexFromId
      : typeof input.winner === "number"
        ? input.winner
        : -1;

  if (input.results === "won" && winnerIndex < 0) {
    throw new Error(
      "invalid_winner_variation_id: winnerVariationId is required and must match an experiment variation when results is won",
    );
  }
  if (input.winnerVariationId && winnerIndexFromId < 0) {
    throw new Error(
      "invalid_winner_variation_id: winnerVariationId must match an experiment variation",
    );
  }

  const winner = winnerIndex >= 0 ? winnerIndex : 0;
  const enableTemporaryRollout =
    input.enableTemporaryRollout !== undefined
      ? input.enableTemporaryRollout
      : input.excludeFromPayload !== undefined
        ? !input.excludeFromPayload
        : false;

  let releasedVariationId = "";
  if (enableTemporaryRollout) {
    releasedVariationId =
      input.releasedVariationId ||
      input.winnerVariationId ||
      variations[winner]?.id ||
      "";
    if (!releasedVariationId) {
      throw new Error(
        "temporary_rollout_requires_released_variation: releasedVariationId or winnerVariationId is required when enableTemporaryRollout is true",
      );
    }
    if (!variations.some((v) => v.id === releasedVariationId)) {
      throw new Error(
        "invalid_winner_variation_id: releasedVariationId must match an experiment variation",
      );
    }
  }

  const changes: Changeset = {
    winner,
    results: input.results,
    analysis: input.analysis,
    releasedVariationId,
    excludeFromPayload: !enableTemporaryRollout,
  };

  const phases = [...experiment.phases];
  if (phases.length) {
    phases[phases.length - 1] = {
      ...phases[phases.length - 1],
      dateEnded: input.dateEnded ? getValidDate(input.dateEnded) : new Date(),
      coverage: enableTemporaryRollout ? 1 : phases[phases.length - 1].coverage,
      reason: input.reason || "",
    };
    changes.phases = phases;
  }

  let isEnding = false;
  if (experiment.status === "running") {
    changes.status = "stopped";
    isEnding = true;
  }

  if (experiment.type === "multi-armed-bandit") {
    changes.banditStage = "paused";
    changes.banditStageDateStarted = new Date();
  }

  const updated = await updateExperiment({
    context,
    experiment,
    changes,
  });

  return { experiment, updated, isEnding };
}

