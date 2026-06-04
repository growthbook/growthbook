import { getLatestPhaseVariations, getAllVariations } from "shared/experiments";
import { getValidDate } from "shared/dates";
import {
  ExperimentInterface,
  LinkedFeatureInfo,
  Changeset,
  ExperimentResultsType,
} from "shared/types/experiment";
import {
  ChecklistStatus,
  ExperimentStartChecklistStatus,
} from "shared/validators";
import {
  getAffectedEnvsForExperiment,
  experimentHasLiveLinkedChanges,
} from "shared/util";
import { orgHasPremiumFeature } from "back-end/src/enterprise";
import { getExperimentLaunchChecklist } from "back-end/src/models/ExperimentLaunchChecklistModel";
import {
  getExperimentById,
  updateExperiment,
} from "back-end/src/models/ExperimentModel";
import { getFeaturesByIds } from "back-end/src/models/FeatureModel";
import { findSDKConnectionsByOrganization } from "back-end/src/models/SdkConnectionModel";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import {
  getChangesToStartExperiment,
  getLinkedFeatureInfo,
} from "back-end/src/services/experiments";
import {
  formatPendingDraftFailureMessage,
  PendingDraftFailure,
  PendingDraftPublishResult,
  publishPendingFeatureDraftsForExperiment,
} from "back-end/src/services/experiment-feature";
import { assertFeatureNotLockedByRamp } from "back-end/src/services/rampSchedule";

export type StartChecklistItemStatus = {
  key: string;
  required: boolean;
  status: ChecklistStatus;
  manual: boolean;
  reason: string;
};

export type ExperimentStartChecklistResult = {
  experiment: ExperimentInterface;
  checklistItems: StartChecklistItemStatus[];
  status: ExperimentStartChecklistStatus;
};

export async function completeExperimentStartChecklistItems({
  context,
  experiment,
  keys,
}: {
  context: ReqContext;
  experiment: ExperimentInterface;
  keys: string[];
}): Promise<ExperimentInterface> {
  if (!context.permissions.canUpdateExperiment(experiment, {})) {
    context.permissions.throwPermissionError();
  }
  if (experiment.type === "holdout") {
    throw new Error("Holdouts are not supported through this endpoint");
  }

  const configuredChecklist =
    (experiment.project &&
      (await getExperimentLaunchChecklist(
        context.org.id,
        experiment.project,
      ))) ||
    (await getExperimentLaunchChecklist(context.org.id, ""));

  const manualTaskKeys = new Set(
    (configuredChecklist?.tasks || [])
      .filter((task) => task.completionType === "manual")
      .map((task) => task.task),
  );

  const invalidKeys = keys.filter((key) => !manualTaskKeys.has(key));
  if (invalidKeys.length > 0) {
    throw new Error(
      `invalid_checklist_keys: ${invalidKeys.join(", ")} are not manual checklist items`,
    );
  }

  const existing = new Map(
    (experiment.manualLaunchChecklist || []).map((item) => [
      item.key,
      item.status,
    ]),
  );
  keys.forEach((key) => existing.set(key, "complete"));

  const manualLaunchChecklist = Array.from(existing.entries()).map(
    ([key, status]) => ({ key, status }),
  );

  return await updateExperiment({
    context,
    experiment,
    changes: { manualLaunchChecklist },
  });
}

export type StopExperimentInput = {
  experimentId: string;
  results: ExperimentResultsType;
  /** @deprecated Used by the internal stop form. Prefer winnerVariationId for new callers. */
  winner?: number;
  /** Preferred way to identify the winning variation. */
  winnerVariationId?: string;
  releasedVariationId?: string;
  enableTemporaryRollout?: boolean;
  reason?: string;
  analysis?: string;
  dateEnded?: string;
};

export type ModifyTemporaryRolloutInput = {
  experimentId: string;
  enableTemporaryRollout: boolean;
  releasedVariationId?: string;
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
    case "schedule":
      return !!experiment.statusUpdateSchedule?.startAt;
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
    manual: false,
    reason: isBandit
      ? "Add at least one live linked change before starting a bandit."
      : "Add at least one linked feature, visual changeset, or URL redirect before starting.",
  });

  if (isBandit) {
    items.push({
      key: "banditGoalMetric",
      required: true,
      status: experiment.goalMetrics?.[0] ? "complete" : "incomplete",
      manual: false,
      reason: "Bandits require a goal metric before starting.",
    });
  }

  items.push({
    key: "targeting",
    required: true,
    status: experiment.phases.length > 0 ? "complete" : "incomplete",
    manual: false,
    reason: "Configure at least one phase with assignment/targeting settings.",
  });

  items.push({
    key: "sdkConnection",
    required: true,
    status: sdkConnections.length > 0 ? "complete" : "incomplete",
    manual: false,
    reason: "Add an SDK connection before starting.",
  });

  const latestVariations = getLatestPhaseVariations(experiment);
  linkedFeatures
    .filter((f) => f.state !== "discarded" && f.state !== "archived")
    .forEach((f) => {
      const configuredVariationIds = new Set(
        f.values.map((v) => v.variationId),
      );
      const hasMissingValues = latestVariations.some(
        (v) => !configuredVariationIds.has(v.id),
      );
      if (hasMissingValues) {
        items.push({
          key: `missingVariationValues:${f.feature.id}`,
          required: true,
          status: "incomplete",
          manual: false,
          reason: `Fill in missing variation values for linked feature ${f.feature.id} before starting.`,
        });
      }
    });

  if (orgHasPremiumFeature(context.org, "custom-launch-checklist")) {
    const checklist =
      (experiment.project &&
        (await getExperimentLaunchChecklist(
          context.org.id,
          experiment.project,
        ))) ||
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
          manual: false,
          reason: `Required custom launch checklist item is incomplete: ${task.task}`,
        });
      } else if (task.completionType === "manual") {
        items.push({
          key: task.task,
          required: true,
          status: isCustomTaskComplete(experiment, task.task)
            ? "complete"
            : "incomplete",
          manual: true,
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

  const linkedFeatures = await getFeaturesByIds(
    context,
    experiment.linkedFeatures || [],
  );
  const envs = getAffectedEnvsForExperiment({
    experiment,
    orgEnvironments: context.org.settings?.environments || [],
    linkedFeatures,
  });

  if (
    envs.length > 0 &&
    !context.permissions.canRunExperiment(experiment, envs)
  ) {
    context.permissions.throwPermissionError();
  }

  return experiment;
}

/**
 * Core experiment start — no permission checks, works from any context
 * (HTTP request or Agenda job). Publishes pending linked feature drafts
 * atomically with the status transition and throws if any draft fails.
 */
export async function executeExperimentStart(
  context: ReqContext | ApiReqContext,
  experiment: ExperimentInterface,
): Promise<{
  updated: ExperimentInterface;
  publishResult: PendingDraftPublishResult;
}> {
  const publishResult = await publishPendingFeatureDraftsForExperiment(
    context,
    experiment,
  );
  if (publishResult.failed.length > 0) {
    const err = new Error(
      formatPendingDraftFailureMessage(publishResult.failed),
    ) as Error & { failedFeatureDrafts?: PendingDraftFailure[] };
    err.failedFeatureDrafts = publishResult.failed;
    throw err;
  }

  // Build a default phase if the experiment has none so getChangesToStartExperiment
  // has valid phases to work with.
  const allVariations = getAllVariations(experiment);
  const defaultVariationWeight =
    allVariations.length > 0 ? 1 / allVariations.length : 1;
  const startExperimentTarget =
    experiment.phases.length > 0
      ? experiment
      : {
          ...experiment,
          phases: [
            {
              coverage: 1,
              dateStarted: new Date(),
              name: "Main",
              reason: "",
              variationWeights: allVariations.map(() => defaultVariationWeight),
              variations: allVariations.map((v) => ({
                id: v.id,
                status: "active" as const,
              })),
              condition: "",
              savedGroups: [],
              namespace: {
                enabled: false,
                name: "",
                range: [0, 1] as [number, number],
              },
            },
          ],
        };

  const changes = await getChangesToStartExperiment(
    context,
    startExperimentTarget,
  );

  if (!experiment.phases.length && !changes.phases) {
    changes.phases = startExperimentTarget.phases;
  }

  const updated = await updateExperiment({
    context,
    experiment,
    changes: { nextScheduledStatusUpdate: null, ...changes },
  });
  return { updated, publishResult };
}

export async function getExperimentStartChecklist({
  context,
  experiment,
}: {
  context: ReqContext;
  experiment: ExperimentInterface;
}): Promise<ExperimentStartChecklistResult> {
  const checklistItems = await getExperimentStartChecklistStatus(
    context,
    experiment,
  );
  const hasIncompleteRequiredItems = checklistItems.some(
    (item) => item.required && item.status === "incomplete",
  );

  return {
    experiment,
    checklistItems,
    status: hasIncompleteRequiredItems ? "notReady" : "ready",
  };
}

export async function startExperiment({
  context,
  experimentId,
  skipChecklist = false,
  bypassLockdown = false,
}: {
  context: ReqContext;
  experimentId: string;
  skipChecklist?: boolean;
  /**
   * When true, skip ramp-schedule lockdown enforcement on linked features and
   * forward the bypass through to pending feature-draft publishing. Caller
   * must verify admin-bypass permissions before passing true.
   */
  bypassLockdown?: boolean;
}) {
  const loadedExperiment = await loadAndValidateExperimentForStatusChange(
    context,
    experimentId,
  );
  const { checklistItems, status } = await getExperimentStartChecklist({
    context,
    experiment: loadedExperiment,
  });

  const experiment = loadedExperiment;
  if (experiment.status !== "draft") {
    throw new Error("invalid_status: Experiment must be in draft status");
  }

  if (status === "notReady" && !skipChecklist) {
    throw new Error(
      `checklist_incomplete: ${checklistItems
        .filter((i) => i.required && i.status === "incomplete")
        .map((i) => i.key)
        .join(", ")}`,
    );
  }

  if (!bypassLockdown) {
    for (const fid of experiment.linkedFeatures ?? []) {
      await assertFeatureNotLockedByRamp(context, fid);
    }
  }

  const { updated } = await executeExperimentStart(context, experiment);

  return { experiment, updated, checklistItems };
}

/**
 * Approves the configured `statusUpdateSchedule.startAt` for a draft
 * experiment by setting the internal `nextScheduledStatusUpdate` field. The
 * agenda job will then auto-start the experiment when the scheduled time is
 * reached. Throws if the experiment is not in draft status or does not have
 * a valid future scheduled start.
 */
export async function approveScheduledExperimentStart({
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
    throw new Error(
      "invalid_status: Experiment must be in draft status to approve a scheduled start",
    );
  }

  const startAt = experiment.statusUpdateSchedule?.startAt
    ? getValidDate(experiment.statusUpdateSchedule.startAt)
    : null;
  if (!startAt || startAt <= new Date()) {
    throw new Error(
      "no_valid_scheduled_start: No valid future scheduled start date to approve",
    );
  }

  if (!skipChecklist) {
    const checklistItems = await getExperimentStartChecklistStatus(
      context,
      experiment,
    );
    const incompleteRequired = checklistItems.filter(
      (item) => item.required && item.status === "incomplete",
    );
    if (incompleteRequired.length > 0) {
      throw new Error(
        `checklist_incomplete: ${incompleteRequired.map((i) => i.key).join(", ")}`,
      );
    }
  }

  const updated = await updateExperiment({
    context,
    experiment,
    changes: {
      nextScheduledStatusUpdate: {
        type: "start",
        date: startAt,
      },
    },
  });

  return { experiment, updated };
}

/**
 * Clears an existing `nextScheduledStatusUpdate` approval on a draft experiment
 * so the agenda job will no longer auto-start it. The configured
 * `statusUpdateSchedule` itself is preserved so the user can re-approve later.
 * Throws if the experiment is not in draft status.
 */
export async function unapproveScheduledExperimentStart({
  context,
  experimentId,
}: {
  context: ReqContext;
  experimentId: string;
}) {
  const experiment = await loadAndValidateExperimentForStatusChange(
    context,
    experimentId,
  );

  if (experiment.status !== "draft") {
    throw new Error(
      "invalid_status: Experiment must be in draft status to unschedule a scheduled start",
    );
  }

  if (!experiment.nextScheduledStatusUpdate) {
    return { experiment, updated: experiment };
  }

  const updated = await updateExperiment({
    context,
    experiment,
    changes: {
      nextScheduledStatusUpdate: null,
    },
  });

  return { experiment, updated };
}

export async function stopExperiment({
  context,
  input,
  allowAlreadyStopped = false,
}: {
  context: ReqContext;
  input: StopExperimentInput;
  allowAlreadyStopped?: boolean;
}) {
  const experiment = await loadAndValidateExperimentForStatusChange(
    context,
    input.experimentId,
  );

  if (
    experiment.status !== "running" &&
    !(allowAlreadyStopped && experiment.status === "stopped")
  ) {
    throw new Error(
      "invalid_status: Can only stop an experiment in running status",
    );
  }
  if (input.dateEnded && Number.isNaN(new Date(input.dateEnded).getTime())) {
    throw new Error("invalid_dateEnded: dateEnded must be an ISO datetime");
  }

  const variations = getAllVariations(experiment);
  const winnerIndexFromId = input.winnerVariationId
    ? variations.findIndex((v) => v.id === input.winnerVariationId)
    : -1;
  const releasedVariationIndexFromId = input.releasedVariationId
    ? variations.findIndex((v) => v.id === input.releasedVariationId)
    : -1;
  if (input.winnerVariationId && winnerIndexFromId < 0) {
    throw new Error(
      "invalid_winner_variation_id: winnerVariationId must match an experiment variation",
    );
  }
  if (input.releasedVariationId && releasedVariationIndexFromId < 0) {
    throw new Error(
      "invalid_released_variation_id: releasedVariationId must match an experiment variation",
    );
  }
  let winner: number;
  // Winner resolution priority:
  // 1) winnerVariationId (preferred)
  // 2) winner (legacy numeric index)
  // 3) releasedVariationId (fallback when winner fields are omitted)
  // 4) existing defaults based on results
  if (input.winnerVariationId) {
    winner = winnerIndexFromId;
  } else if (typeof input.winner === "number") {
    const legacyWinner = input.winner;
    if (
      (legacyWinner < 0 && legacyWinner !== -1) ||
      legacyWinner >= variations.length
    ) {
      throw new Error(
        "invalid_winner: winner must be -1 or match an experiment variation index",
      );
    }
    if (input.results === "won" && legacyWinner < 0) {
      throw new Error(
        "invalid_winner: winner must match an experiment variation index when results is won",
      );
    }
    winner = legacyWinner;
  } else if (input.releasedVariationId) {
    winner = releasedVariationIndexFromId;
  } else if (input.results === "won") {
    if (variations.length === 2) {
      // Default to the single test variation (index 1) when no winner is provided.
      winner = 1;
    } else {
      throw new Error(
        "invalid_winner_variation_id: winnerVariationId is required when results is won unless the experiment has exactly 2 variations",
      );
    }
  } else {
    // For non-won results, default to baseline variation.
    winner = 0;
  }

  const enableTemporaryRollout = input.enableTemporaryRollout === true;
  const releasedVariationId = input.releasedVariationId ?? "";
  if (enableTemporaryRollout) {
    if (!releasedVariationId) {
      throw new Error(
        "temporary_rollout_requires_released_variation: releasedVariationId is required when enableTemporaryRollout is true",
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

export async function modifyTemporaryRollout({
  context,
  input,
}: {
  context: ReqContext;
  input: ModifyTemporaryRolloutInput;
}) {
  const experiment = await loadAndValidateExperimentForStatusChange(
    context,
    input.experimentId,
  );
  if (experiment.status !== "stopped") {
    throw new Error(
      "invalid_status: Can only modify temporary rollout for stopped experiments",
    );
  }

  if (input.enableTemporaryRollout && !input.releasedVariationId) {
    throw new Error(
      "invalid_released_variation_id: releasedVariationId is required when enableTemporaryRollout is true",
    );
  }

  const variations = getAllVariations(experiment);
  const releasedVariationIndexFromId = input.releasedVariationId
    ? variations.findIndex((v) => v.id === input.releasedVariationId)
    : -1;
  if (input.releasedVariationId && releasedVariationIndexFromId < 0) {
    throw new Error(
      "invalid_released_variation_id: releasedVariationId must match an experiment variation",
    );
  }

  const changes: Changeset = {
    excludeFromPayload: !input.enableTemporaryRollout,
    ...(input.releasedVariationId
      ? { releasedVariationId: input.releasedVariationId }
      : {}),
  };

  if (input.enableTemporaryRollout) {
    const phases = [...experiment.phases];
    if (phases.length > 0) {
      phases[phases.length - 1] = {
        ...phases[phases.length - 1],
        coverage: 1,
      };
      changes.phases = phases;
    }
  }

  const updated = await updateExperiment({
    context,
    experiment,
    changes,
  });

  return { experiment, updated };
}
