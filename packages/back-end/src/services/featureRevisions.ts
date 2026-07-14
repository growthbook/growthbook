import { v4 as uuidv4 } from "uuid";
import cloneDeep from "lodash/cloneDeep";
import omit from "lodash/omit";
import {
  MergeResultChanges,
  checkIfRevisionNeedsReview,
  autoMerge,
  liveRevisionFromFeature,
  PermissionError,
  stemRuleId,
} from "shared/util";
import {
  SafeRolloutInterface,
  SafeRolloutRule,
  RampScheduleInterface,
  RampScheduleTemplateInterface,
  RevisionRampAction,
  RevisionRampCreateAction,
  RevisionRampUpdateAction,
  RampStepAction,
} from "shared/validators";
import { UpdateProps } from "shared/types/base-model";
import { FeatureInterface, FeatureRule } from "shared/types/feature";
import { EventUser } from "shared/types/events/event-types";
import { OrganizationInterface } from "shared/types/organization";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import {
  addIdsToFlatRules,
  generateRuleId,
  getNextScheduledUpdate,
} from "back-end/src/services/features";
import {
  appendRampEvent,
  assertFeatureNotLockedByRamp,
  computeNextProcessAt,
  ensureSafeRolloutForMonitoredRamp,
  getStartActionsFromRules,
  mergeStepsForRunningSchedule,
  remapTemplateActions,
  runLockedRampScheduleAction,
  startReadyScheduleNow,
  syncLinkedSafeRolloutForRampState,
} from "back-end/src/services/rampSchedule";
import { NotFoundError } from "back-end/src/util/errors";
import { getApplicableEnvIds } from "back-end/src/util/flattenRules";
import { ReqContext } from "back-end/types/request";
import { getLinkedExperiments } from "back-end/src/util/features";
import { applyPartialFeatureRuleUpdatesToRevision } from "back-end/src/util/featureRevision.util";
import { logger } from "back-end/src/util/logger";
import { getEnvironmentIdsFromOrg } from "back-end/src/services/organizations";
import { getEnvironments } from "back-end/src/util/organization.util";
import { ApiReqContext } from "back-end/types/api";
import { determineNextSafeRolloutSnapshotAttempt } from "back-end/src/enterprise/saferollouts/safeRolloutUtils";
import {
  runValidateFeatureHooks,
  runValidateFeatureRevisionHooks,
} from "back-end/src/enterprise/sandbox/sandbox-eval";
import {
  clearPendingFeatureDraftsForRevision,
  getExperimentById,
  updateExperiment,
} from "back-end/src/models/ExperimentModel";
import {
  getRevision,
  hasPublishLockingScheduledSibling,
  markRevisionAsPublished,
  computeRevisionPublishChanges,
  updateRevision,
  createRevision,
} from "back-end/src/models/FeatureRevisionModel";

/**
 * Append a rule to `revision.rules`. `envs === undefined` or an `envs` list
 * covering every applicable env collapses to `allEnvironments: true`.
 */
export async function addFeatureRule(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  revision: FeatureRevisionInterface,
  envs: string[] | undefined,
  rule: FeatureRule,
  user: EventUser,
  resetReview: boolean,
) {
  if (!rule.id) {
    rule.id = generateRuleId();
  }
  if (rule.type === "rollout" && !rule.seed) {
    rule.seed = rule.id;
  }

  const applicableEnvs = getEnvironmentIdsFromOrg(context.org);
  const isAllEnvs =
    !envs || envs.length === 0 || applicableEnvs.every((e) => envs.includes(e));

  const scopedRule: FeatureRule = isAllEnvs
    ? ({ ...rule, allEnvironments: true } as FeatureRule)
    : ({
        ...rule,
        allEnvironments: false,
        environments: [...envs!],
      } as FeatureRule);

  const nextRules: FeatureRule[] = [...(revision.rules ?? []), scopedRule];

  await updateRevision(
    context,
    feature,
    revision,
    { rules: nextRules },
    {
      user,
      action: "add rule",
      subject: isAllEnvs ? "to all environments" : `to ${envs!.join(", ")}`,
      value: JSON.stringify(scopedRule),
    },
    resetReview,
  );
}

// Edit a single rule by `ruleId`. `auditEnvironment` is only used for the
// audit log subject. See `editFeatureRules` for the batch form.
export async function editFeatureRule(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  revision: FeatureRevisionInterface,
  ruleId: string,
  updates: Partial<FeatureRule>,
  user: EventUser,
  resetReview: boolean,
  auditEnvironment?: string,
) {
  return await editFeatureRules(
    context,
    feature,
    revision,
    [{ ruleId, environmentId: auditEnvironment }],
    updates,
    user,
    resetReview,
  );
}

/**
 * Batch edit rules matched by `ruleId`. `environmentId` is used only for the
 * audit log subject; matching is by id alone. Duplicate ids collapse to a
 * single overlay (idempotent).
 */
export async function editFeatureRules(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  revision: FeatureRevisionInterface,
  matches: { ruleId: string; environmentId?: string }[],
  updates: Partial<FeatureRule>,
  user: EventUser,
  resetReview: boolean,
) {
  const projected = applyPartialFeatureRuleUpdatesToRevision(
    revision,
    matches.map((m) => m.ruleId),
    updates,
  );

  // Audit subject uses caller-supplied envs (the user's tab context), not
  // the rule's underlying scope.
  const envs = Array.from(
    new Set(
      matches.map((m) => m.environmentId).filter((e): e is string => !!e),
    ),
  );
  const subject =
    envs.length === 0
      ? `rule ${matches[0]?.ruleId ?? ""}`
      : envs.length === 1
        ? `in ${envs[0]}`
        : `in ${envs.join(", ")}`;

  const updatedRevision = await updateRevision(
    context,
    feature,
    revision,
    { rules: projected.rules ?? [] },
    {
      user,
      action: "edit rule",
      subject,
      value: JSON.stringify(updates),
    },
    resetReview,
  );
  return updatedRevision;
}

export async function setDefaultValue(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  revision: FeatureRevisionInterface,
  defaultValue: string,
  user: EventUser,
  requireReview: boolean,
) {
  return updateRevision(
    context,
    feature,
    revision,
    { defaultValue },
    {
      user,
      action: "edit default value",
      subject: ``,
      value: JSON.stringify({ defaultValue }),
    },
    requireReview,
  );
}

const updateSafeRolloutStatuses = async (
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  revision: FeatureRevisionInterface,
) => {
  if (!revision.rules || revision.rules.length === 0) return;

  const safeRolloutStatusesMap: Record<
    string,
    { status: "running" | "rolled-back" | "released" | "stopped" }
  > = Object.fromEntries(
    revision.rules
      .filter((rule): rule is SafeRolloutRule => rule?.type === "safe-rollout")
      .map((rule) => [rule.safeRolloutId, { status: rule.status }]),
  );
  // Stop safe rollouts whose rule was removed in this revision.
  (feature.rules ?? []).forEach((rule) => {
    if (
      rule?.type === "safe-rollout" &&
      !safeRolloutStatusesMap[rule.safeRolloutId]
    ) {
      safeRolloutStatusesMap[rule.safeRolloutId] = { status: "stopped" };
    }
  });

  const safeRollouts = await context.models.safeRollout.getByIds(
    Object.keys(safeRolloutStatusesMap),
  );

  safeRollouts.forEach((safeRollout) => {
    // sync the status of the safe rollout to the status of the revision
    const safeRolloutUpdates: UpdateProps<SafeRolloutInterface> = {
      status: safeRolloutStatusesMap[safeRollout.id].status,
    };
    if (!safeRollout.startedAt && safeRolloutUpdates.status === "running") {
      safeRolloutUpdates["startedAt"] = new Date();
      const { nextSnapshot, nextRampUp } =
        determineNextSafeRolloutSnapshotAttempt(safeRollout, context.org);
      safeRolloutUpdates["nextSnapshotAttempt"] = nextSnapshot;
      safeRolloutUpdates["rampUpSchedule"] = {
        ...safeRollout.rampUpSchedule,
        nextUpdate: nextRampUp,
      };
    }

    context.models.safeRollout.update(safeRollout, safeRolloutUpdates);
  });
};

// Pure computation of the feature-doc changes a revision merge will produce; no writes
export function computeRevisionMergeChanges(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  revision: FeatureRevisionInterface,
  result: MergeResultChanges,
): {
  changes: UpdateProps<FeatureInterface>;
  hasChanges: boolean;
  removeHoldout: boolean;
} {
  let hasChanges = false;
  const changes: UpdateProps<FeatureInterface> = {};
  let removeHoldout = false;

  if (result.defaultValue !== undefined) {
    changes.defaultValue = result.defaultValue;
    hasChanges = true;
  }

  if (result.rules !== undefined) {
    changes.rules = result.rules;
    // Ensure every rollout rule that's being published has a seed — required
    // for ramp-monitored payload stability. Rules created before the
    // seed-backfill was introduced (or attached to a ramp for the first time)
    // get seed = rule.id here so they match the SDK's featureId fallback.
    addIdsToFlatRules(changes.rules, feature.id);
    hasChanges = true;
  }

  if (result.environmentsEnabled) {
    const envs = getEnvironmentIdsFromOrg(context.org);
    const nextEnvSettings = cloneDeep(feature.environmentSettings || {});
    let envChanged = false;
    envs.forEach((env) => {
      const desired = result.environmentsEnabled?.[env];
      if (desired === undefined) return;
      const current = nextEnvSettings[env] || { enabled: false };
      // Skip no-op writes so we don't invalidate the SDK payload cache.
      if (current.enabled !== desired) envChanged = true;
      nextEnvSettings[env] = { ...current, enabled: desired };
    });
    if (envChanged) {
      changes.environmentSettings = nextEnvSettings;
      hasChanges = true;
    }
  }

  if (result.prerequisites !== undefined) {
    changes.prerequisites = result.prerequisites;
    hasChanges = true;
  }

  if (result.archived !== undefined) {
    changes.archived = result.archived;
    hasChanges = true;
  }

  if (result.holdout !== undefined) {
    // null means remove from holdout; object means set/change holdout
    if (result.holdout === null) {
      removeHoldout = true;
    } else {
      changes.holdout = result.holdout;
    }
    hasChanges = true;
  }

  if (result.metadata) {
    const m = result.metadata;
    if (m.description !== undefined) changes.description = m.description;
    if (m.owner !== undefined) changes.owner = m.owner;
    if (m.project !== undefined) changes.project = m.project;
    if (m.tags !== undefined) changes.tags = m.tags;
    if (m.neverStale !== undefined) changes.neverStale = m.neverStale;
    if (m.customFields !== undefined)
      changes.customFields = m.customFields as Record<string, unknown>;
    if (m.jsonSchema !== undefined) changes.jsonSchema = m.jsonSchema;
    hasChanges = true;
  }

  // No content delta — still advance feature.version so the revision we're
  // about to mark published becomes live. Skipping this leaves a "Locked"
  // revision behind a stale feature.version, which traps subsequent reverts.
  if (!hasChanges) {
    changes.version = revision.version;
    return { changes, hasChanges, removeHoldout };
  }

  if (changes.rules !== undefined) {
    changes.nextScheduledUpdate = getNextScheduledUpdate(changes.rules);
  }

  changes.version = revision.version;

  return { changes, hasChanges, removeHoldout };
}

// Apply a revision merge result to the feature document. Feature writes skip
// the model-level manageFeatures check — publish authority is the env-scoped
// publishFeatures permission, checked by the caller.
export async function applyRevisionChanges(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  revision: FeatureRevisionInterface,
  result: MergeResultChanges,
) {
  const { changes, hasChanges, removeHoldout } = computeRevisionMergeChanges(
    context,
    feature,
    revision,
    result,
  );

  if (!hasChanges) {
    return await context.models.features.dangerousUpdateBypassPermission(
      feature,
      changes,
    );
  }

  await updateSafeRolloutStatuses(context, feature, revision);

  // Handle holdout removal separately since the feature update only does $set
  if (removeHoldout) {
    await context.models.features.removeHoldout(feature);
    // Remove holdout from the feature object so the returned feature is correct
    const { holdout: _, ...featureWithoutHoldout } = feature;
    return await context.models.features.dangerousUpdateBypassPermission(
      featureWithoutHoldout as FeatureInterface,
      changes,
    );
  }

  return await context.models.features.dangerousUpdateBypassPermission(
    feature,
    changes,
  );
}

// Run HoldoutModel / Experiment side-effects when a feature's holdout
// membership changes at publish. Called from `publishRevision` when
// `result.holdout` is defined, so all publish paths (direct, approval,
// revert, etc.) are covered. `feature` is pre-publish (used for prevHoldout);
// `newHoldout: null` means "remove from holdout".
export async function applyHoldoutSideEffects(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  newHoldout: { id: string; value: string } | null,
) {
  const prevHoldoutId = feature.holdout?.id;
  const newHoldoutId = newHoldout?.id;

  if (newHoldoutId === prevHoldoutId) return;

  // Guard: cannot change holdout when there are running experiments, bandits, or safe rollouts
  if (newHoldout !== null) {
    const experiments = await Promise.all(
      (feature.linkedExperiments ?? []).map((id) =>
        getExperimentById(context, id),
      ),
    );
    const hasNonDraftExperiments = experiments.some(
      (exp) => exp?.status !== "draft",
    );
    const hasBandits = experiments.some(
      (exp) => exp?.type === "multi-armed-bandit",
    );
    const hasSafeRollouts = (feature.rules ?? []).some(
      (rule) => rule?.type === "safe-rollout",
    );
    if (hasNonDraftExperiments || hasBandits || hasSafeRollouts) {
      throw new Error(
        "Cannot change holdout when there are running linked experiments, safe rollout rules, or multi-armed bandit rules",
      );
    }
  }

  // Remove feature from the old holdout
  if (prevHoldoutId) {
    await context.models.holdout.removeFeatureFromHoldout(
      prevHoldoutId,
      feature.id,
    );
  }

  // Link feature (and its experiments) to the new holdout
  if (newHoldoutId) {
    const holdoutObj = await context.models.holdout.getById(newHoldoutId);
    if (!holdoutObj) {
      throw new Error("Holdout not found");
    }

    await context.models.holdout.updateById(newHoldoutId, {
      linkedFeatures: {
        [feature.id]: { id: feature.id, dateAdded: new Date() },
        ...holdoutObj.linkedFeatures,
      },
      ...(feature.linkedExperiments?.length
        ? {
            linkedExperiments: {
              ...Object.fromEntries(
                feature.linkedExperiments.map((experimentId) => [
                  experimentId,
                  { id: experimentId, dateAdded: new Date() },
                ]),
              ),
              ...holdoutObj.linkedExperiments,
            },
          }
        : {}),
    });

    if (feature.linkedExperiments?.length) {
      const linkedExperiments = await Promise.all(
        feature.linkedExperiments.map((eid) => getExperimentById(context, eid)),
      );
      await Promise.all(
        linkedExperiments.map(async (exp) => {
          if (!exp) return;
          return updateExperiment({
            context,
            experiment: exp,
            changes: { holdoutId: newHoldoutId },
          });
        }),
      );
    }
  }
}

// Apply deferred ramp create/update actions stored on a revision.
// - `create` actions are called BEFORE feature write so schedule creation
//   failures abort publish.
// - `update` actions are called AFTER publish succeeds (best-effort).
// Returns only newly created schedule IDs (for rollback on failure).
async function createRampSchedulesForRevision(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  revision: { version: number },
  result: MergeResultChanges,
  actions: RevisionRampAction[],
): Promise<string[]> {
  const createdIds: string[] = [];

  for (const action of actions) {
    if (action.mode !== "create" && action.mode !== "update") continue;

    // Pro gate — see postRampSchedule.ts for rationale.
    if (!context.hasPremiumFeature("schedule-feature-flag")) {
      context.throwPlanDoesNotAllowError(
        "Ramp schedules require a Pro plan or above.",
      );
    }

    const existingSchedule =
      action.mode === "update"
        ? await context.models.rampSchedules.getById(action.rampScheduleId)
        : null;
    if (action.mode === "update" && !existingSchedule) {
      logger.warn(
        { rampScheduleId: action.rampScheduleId, ruleId: action.ruleId },
        "Ramp schedule not found at revision publish time — skipping deferred update action",
      );
      continue;
    }

    const existingTarget =
      action.mode === "update"
        ? existingSchedule?.targets.find(
            (t) => stemRuleId(t.ruleId ?? "") === stemRuleId(action.ruleId),
          )
        : null;
    if (action.mode === "update" && !existingTarget) {
      logger.warn(
        {
          rampScheduleId: action.rampScheduleId,
          ruleId: action.ruleId,
        },
        "Ramp schedule target no longer matches rule at revision publish time — skipping deferred update action",
      );
      continue;
    }

    const targetId = existingTarget?.id ?? uuidv4();

    // Inject the generated targetId into every action and ensure targetType
    // is always set. Handles both correctly-typed actions and legacy drafts
    // that were stored without targetType.
    const normalizeAction = (
      a: RevisionRampCreateAction["steps"][number]["actions"][number],
    ): RampStepAction => ({
      targetType: "feature-rule" as const,
      targetId,
      patch: {
        ...a.patch,
        ruleId: action.ruleId,
      },
    });

    // Template is used as a fallback; explicit steps/endActions win.
    let template: RampScheduleTemplateInterface | undefined;
    if (action.templateId) {
      const tmpl = await context.models.rampScheduleTemplates.getById(
        action.templateId,
      );
      if (!tmpl) {
        logger.warn(
          { templateId: action.templateId },
          "Ramp schedule template not found at revision publish time — skipping template",
        );
      } else {
        template = tmpl;
      }
    }

    const defaultName = `Ramp schedule \u2013 ${new Date().toLocaleDateString(
      "en-US",
      { month: "short", year: "numeric" },
    )}`;

    const startDate =
      action.startDate === null
        ? null
        : action.startDate
          ? new Date(action.startDate)
          : undefined;

    const explicitSteps = Array.isArray(action.steps) ? action.steps : [];
    // Whether the caller explicitly provided steps (only when at least one step
    // is present, or a template is used). When false on an update action,
    // fall back to the existing schedule's steps to avoid wiping them.
    // Note: steps: [] is treated as "not provided" — an empty array does NOT
    // clear existing steps.
    const stepsExplicit = explicitSteps.length > 0 || !!template;
    const steps: RampScheduleInterface["steps"] =
      explicitSteps.length > 0
        ? explicitSteps.map((step) => ({
            ...step,
            actions: Array.isArray(step.actions)
              ? step.actions.map(normalizeAction)
              : [],
            monitored: !!step.monitored,
            holdConditions: step.holdConditions ?? undefined,
          }))
        : template
          ? template.steps.map((s) => ({
              interval: s.interval,
              actions: remapTemplateActions(
                s.actions,
                targetId,
                action.ruleId,
                feature.valueType,
              ),
              approvalNotes: s.approvalNotes ?? undefined,
              monitored: !!s.monitored,
              holdConditions: s.holdConditions ?? undefined,
            }))
          : action.mode === "update"
            ? // No explicit steps and no template: preserve the existing
              // schedule's steps so a caller who only wants to change name /
              // startDate / cutoffDate doesn't accidentally wipe them.
              (existingSchedule?.steps ?? [])
            : [];

    // null = explicitly cleared (skip template); undefined = not set (fall back to template).
    const endActions: RampStepAction[] =
      action.endActions !== undefined
        ? Array.isArray(action.endActions)
          ? action.endActions.map(normalizeAction)
          : []
        : template?.endPatch && Object.keys(template.endPatch).length > 0
          ? [
              {
                targetType: "feature-rule" as const,
                targetId,
                patch: {
                  ruleId: action.ruleId,
                  ...template.endPatch,
                },
              },
            ]
          : [];

    const startActions: RampStepAction[] =
      action.startActions !== undefined
        ? Array.isArray(action.startActions)
          ? action.startActions.map(normalizeAction)
          : []
        : getStartActionsFromRules({
            rules: result.rules ?? feature.rules ?? [],
            targetId,
            ruleId: action.ruleId,
            environment: action.environment,
          });

    if (action.mode === "create") {
      // Guard against duplicate schedules: if the revision is re-published or
      // an older revision is published while a live schedule already targets
      // this rule, skip the create rather than producing a second schedule
      // that both try to drive the same rule.
      const existing = await context.models.rampSchedules.findByTargetRule(
        action.ruleId,
        action.environment ?? undefined,
      );
      if (existing.length > 0) {
        logger.warn(
          {
            ruleId: action.ruleId,
            conflictingScheduleId: existing[0].id,
            revisionVersion: revision.version,
          },
          "Skipping deferred ramp create action — a live schedule already targets this rule",
        );
        continue;
      }

      const created = await context.models.rampSchedules.create({
        name: action.name ?? defaultName,
        entityType: "feature",
        entityId: feature.id,
        targets: [
          {
            id: targetId,
            entityType: "feature",
            entityId: feature.id,
            ruleId: action.ruleId,
            // null = patches apply to all environments sharing this ruleId.
            // A specific environment = patches are scoped to that env only.
            environment: action.environment ?? null,
            status: "active",
            // Link this target to the activating revision so onRevisionPublished
            // (and the Agenda recovery path) can transition "pending" → "running".
            activatingRevisionVersion: revision.version,
          },
        ],
        startActions: startActions.length > 0 ? startActions : undefined,
        steps,
        endActions: endActions.length > 0 ? endActions : undefined,
        startDate: startDate ?? undefined,
        cutoffDate: action.cutoffDate
          ? new Date(action.cutoffDate)
          : action.cutoffDate === null
            ? null
            : undefined,
        monitoringConfig: action.monitoringConfig ?? template?.monitoringConfig,
        lockdownConfig: action.lockdownConfig ?? template?.lockdownConfig,
        // Start as "pending" — onActivatingRevisionPublished handles the
        // immediate → "running" transition inline when the revision publishes.
        status: "pending",
        currentStepIndex: -1,
        nextStepAt:
          !startDate && steps.length > 0 ? new Date() : (startDate ?? null),
        startedAt: null,
        phaseStartedAt: null,
      });

      createdIds.push(created.id);
      continue;
    }

    const updateAction = action as RevisionRampUpdateAction;
    const nextStartDate =
      startDate !== undefined
        ? startDate
        : (existingSchedule?.startDate ?? null);
    const nextCutoffDate =
      updateAction.cutoffDate !== undefined
        ? updateAction.cutoffDate
          ? new Date(updateAction.cutoffDate)
          : null
        : (existingSchedule?.cutoffDate ?? null);
    const nextMonitoringConfig =
      updateAction.monitoringConfig !== undefined
        ? updateAction.monitoringConfig
        : existingSchedule?.monitoringConfig;
    // "Start now": user explicitly cleared startDate on a not-yet-started
    // schedule. Transition ready → running inline so the rule goes live on
    // publish instead of at the next poller tick. A ready schedule has all
    // fields editable (startActions included — the ramp hasn't fired), so no
    // running-merge / paused-clamp handling is needed here.
    let startDeferredToScheduler = false;
    if (
      updateAction.startDate === null &&
      existingSchedule?.status === "ready"
    ) {
      const contentUpdates: Parameters<typeof startReadyScheduleNow>[2] = {};
      const edited: string[] = [];
      const set = (provided: boolean, key: string, value: unknown) => {
        if (!provided) return;
        (contentUpdates as Record<string, unknown>)[key] = value;
        edited.push(key);
      };
      set(updateAction.name !== undefined, "name", updateAction.name);
      set(
        updateAction.startActions !== undefined,
        "startActions",
        startActions.length > 0 ? startActions : undefined,
      );
      set(stepsExplicit, "steps", steps);
      set(
        updateAction.endActions !== undefined,
        "endActions",
        endActions.length > 0 ? endActions : undefined,
      );
      set(updateAction.cutoffDate !== undefined, "cutoffDate", nextCutoffDate);
      set(
        updateAction.monitoringConfig !== undefined,
        "monitoringConfig",
        nextMonitoringConfig,
      );
      set(
        updateAction.lockdownConfig !== undefined,
        "lockdownConfig",
        updateAction.lockdownConfig,
      );
      edited.push("startDate"); // always changed on this path (cleared)

      // A "config-edited" event rides along so startReadyScheduleNow appends
      // "started" on top of it, matching the direct-edit path.
      const history = appendRampEvent(existingSchedule, "config-edited", {
        stepIndex: existingSchedule.currentStepIndex,
        status: existingSchedule.status,
        reason: `Edited via draft: ${edited.join(", ")}`,
      });
      const started = await startReadyScheduleNow(context, existingSchedule, {
        ...contentUpdates,
        cutoffDate: nextCutoffDate,
        auditEvent: history[history.length - 1],
      });
      if (started) continue;
      // Start didn't run: either the scheduler started it first (the locked
      // update below applies the edits) or the lock stayed busy and the start
      // was deferred via startDate=now — don't clobber that deferral.
      const reread = await context.models.rampSchedules.getById(
        updateAction.rampScheduleId,
      );
      if (!reread) {
        logger.warn(
          { rampScheduleId: updateAction.rampScheduleId },
          "Ramp schedule removed while applying start-now update — skipping",
        );
        continue;
      }
      startDeferredToScheduler = reread.status === "ready";
    }

    // Apply the edits under the advance lock, deriving state-dependent pieces
    // (running merge, paused clamp, audit history, nextProcessAt inputs) from
    // the in-lock fresh doc — the schedule may have started, advanced, or been
    // edited since the pre-publish read.
    try {
      await runLockedRampScheduleAction(
        context,
        updateAction.rampScheduleId,
        async (fresh) => {
          const isRunning = fresh.status === "running";
          const canEditStartActions =
            fresh.status === "pending" || fresh.status === "ready";
          const startDateChanged = updateAction.startDate !== undefined;

          // Collect the caller's config edits. `set` writes a key only when the
          // field was provided, so omitted fields are preserved, and records
          // which fields changed for the audit trail.
          const patch: Record<string, unknown> = {};
          const edited: string[] = [];
          const set = (provided: boolean, key: string, value: unknown) => {
            if (!provided) return;
            patch[key] = value;
            edited.push(key);
          };

          set(updateAction.name !== undefined, "name", updateAction.name);
          set(
            updateAction.cutoffDate !== undefined,
            "cutoffDate",
            nextCutoffDate,
          );
          set(
            updateAction.monitoringConfig !== undefined,
            "monitoringConfig",
            nextMonitoringConfig,
          );
          set(
            updateAction.lockdownConfig !== undefined,
            "lockdownConfig",
            updateAction.lockdownConfig,
          );
          // endActions only apply at completion, so they're safe to edit mid-run.
          set(
            updateAction.endActions !== undefined,
            "endActions",
            endActions.length > 0 ? endActions : undefined,
          );

          if (isRunning) {
            // Running TOCTOU guard: freeze the past, allow only holds/notes on
            // the current step, apply future steps. startActions stay frozen —
            // they're the rollback restore point.
            if (stepsExplicit) {
              set(
                true,
                "steps",
                mergeStepsForRunningSchedule(fresh, steps).steps,
              );
            }
          } else {
            set(stepsExplicit, "steps", steps);
            set(
              canEditStartActions && updateAction.startActions !== undefined,
              "startActions",
              startActions.length > 0 ? startActions : undefined,
            );
            if (startDateChanged) edited.push("startDate");
            if (startDateChanged && !startDeferredToScheduler) {
              patch.startDate = nextStartDate;
            }
            // Steps edited on a paused schedule: clamp the playhead and let
            // resume recompute timing. Internal fields, not part of the audit.
            if (
              fresh.status === "paused" &&
              fresh.currentStepIndex >= steps.length
            ) {
              patch.currentStepIndex = Math.max(steps.length - 1, -1);
              patch.nextStepAt = null;
            }
          }

          if (edited.length > 0) {
            patch.eventHistory = appendRampEvent(fresh, "config-edited", {
              stepIndex: fresh.currentStepIndex,
              status: fresh.status,
              reason: `Edited via draft: ${edited.join(", ")}`,
            });
          }

          patch.nextProcessAt = computeNextProcessAt({
            status: fresh.status,
            nextStepAt: fresh.nextStepAt,
            cutoffDate:
              updateAction.cutoffDate !== undefined
                ? nextCutoffDate
                : (fresh.cutoffDate ?? null),
            // running ignores startDate; ready uses it. Only reflect the new
            // startDate when we actually persist it here.
            startDate:
              !isRunning && startDateChanged && !startDeferredToScheduler
                ? nextStartDate
                : (fresh.startDate ?? null),
            nextSnapshotAt: fresh.nextSnapshotAt,
          });

          const updated = await context.models.rampSchedules.updateById(
            fresh.id,
            patch,
          );

          // Sync SafeRollout in case monitored-step membership changed.
          if (isRunning && patch.steps) {
            const ensured = await ensureSafeRolloutForMonitoredRamp(
              context,
              updated,
            );
            await syncLinkedSafeRolloutForRampState(context, ensured);
          }
        },
      );
    } catch (e) {
      if (e instanceof NotFoundError) {
        logger.warn(
          { rampScheduleId: updateAction.rampScheduleId },
          "Ramp schedule removed while applying update action — skipping",
        );
        continue;
      }
      throw e;
    }
  }

  return createdIds;
}

/**
 * Apply detach/update ramp actions stored on a revision.
 * Best-effort: logs errors but does not throw, since these run after the feature is published.
 */
async function applyDetachRampActions(
  context: ReqContext | ApiReqContext,
  actions: RevisionRampAction[],
) {
  for (const action of actions) {
    if (action.mode !== "detach") continue;
    try {
      const existing = await context.models.rampSchedules.getById(
        action.rampScheduleId,
      );
      if (existing) {
        // Stem-match so a bare `fr_abc` detach action matches a suffixed
        // `fr_abc__production` target (and vice versa).
        const actionStem = stemRuleId(action.ruleId);
        const remainingTargets = existing.targets.filter(
          (t) => stemRuleId(t.ruleId ?? "") !== actionStem,
        );
        if (action.deleteScheduleWhenEmpty && remainingTargets.length === 0) {
          // Stop the linked SafeRollout before deletion so it doesn't continue
          // taking snapshots against a ramp that no longer exists.
          if (existing.safeRolloutId) {
            await syncLinkedSafeRolloutForRampState(
              context,
              { ...existing, status: "rolled-back" },
              "stopped",
            );
          }
          await context.models.rampSchedules.deleteById(existing.id);
        } else {
          await context.models.rampSchedules.updateById(existing.id, {
            targets: remainingTargets,
          });
        }
      }
    } catch (err) {
      logger.error(err, {
        msg: "Failed to apply revision ramp detach action",
        action,
      });
    }
  }
}

async function cleanupOrphanedRampSchedules(
  context: ReqContext | ApiReqContext,
  oldFeature: FeatureInterface,
  newFeature: FeatureInterface,
) {
  try {
    // When publishing a change that modifies rules, clean up ramp schedules that
    // become orphaned. This handles several scenarios:
    // 1. Rules that target a ramp are deleted → ramp is cleaned up
    // 2. Reverting to an older revision that predates a ramp's creation → ramp's
    //    targets (from newer revisions) are removed, orphaning the ramp → cleanup deletes it
    // 3. Reverting back to a newer revision with a ramp → the ramp is recreated via
    //    the inline "create" action on the rule (natural behavior)
    //
    // Note: If a ramp schedule is deleted and then we revert to a future revision
    // where it should exist, the "create" action will not fire again. The user must
    // re-create the ramp. This is the safe, explicit behavior.

    // Compare by stem (not raw id). A rule may be split across revisions —
    // e.g. `fr_abc` → `fr_abc__production` + `fr_abc__dev` — and ramp
    // targets reference stem identity.
    const oldStems = new Set<string>(
      (oldFeature.rules ?? [])
        .map((r) => (r?.id ? stemRuleId(r.id) : null))
        .filter((id): id is string => !!id),
    );
    const newStems = new Set<string>(
      (newFeature.rules ?? [])
        .map((r) => (r?.id ? stemRuleId(r.id) : null))
        .filter((id): id is string => !!id),
    );

    const deletedStems = new Set<string>(
      [...oldStems].filter((s) => !newStems.has(s)),
    );

    const allRamps = await context.models?.rampSchedules?.getAllByFeatureId?.(
      newFeature.id,
    );

    if (!allRamps) return;

    for (const ramp of allRamps) {
      const originalTargets = ramp?.targets ?? [];
      if (originalTargets.length === 0 || !ramp?.id) continue;
      const remainingTargets = originalTargets.filter(
        (target: RampScheduleInterface["targets"][0]) => {
          if (!target?.ruleId) return false;
          return !deletedStems.has(stemRuleId(target.ruleId));
        },
      );

      if (remainingTargets.length === 0) {
        // Stop the linked SafeRollout before deletion so it doesn't continue
        // taking snapshots against a ramp that no longer exists.
        if (ramp.safeRolloutId) {
          await syncLinkedSafeRolloutForRampState(
            context,
            { ...ramp, status: "rolled-back" },
            "stopped",
          );
        }
        await context.models?.rampSchedules?.deleteById?.(ramp.id);
      } else if (remainingTargets.length !== originalTargets.length) {
        // Some targets were orphaned by the delete; prune them so the schedule
        // doesn't fail trying to resolve a deleted ruleId on its next fire.
        await context.models?.rampSchedules?.updateById?.(ramp.id, {
          targets: remainingTargets,
        });
      }
    }
  } catch (error) {
    // Log but don't throw — cleanup is a nice-to-have, not essential for publish to succeed.
    logger.error("Error cleaning up orphaned ramp schedules", error);
  }
}

// Best-effort early hook run; the feature update / markRevisionAsPublished re-run hooks authoritatively
export async function prevalidatePublishRevision({
  context,
  feature,
  revision,
  result,
  comment,
}: {
  context: ReqContext | ApiReqContext;
  feature: FeatureInterface;
  revision: FeatureRevisionInterface;
  result: MergeResultChanges;
  comment?: string;
}) {
  const { changes, removeHoldout } = computeRevisionMergeChanges(
    context,
    feature,
    revision,
    result,
  );
  const base = removeHoldout
    ? (omit(feature, ["holdout"]) as FeatureInterface)
    : feature;
  const proposedFeature: FeatureInterface = {
    ...base,
    ...changes,
    dateUpdated: new Date(),
  };
  proposedFeature.linkedExperiments = getLinkedExperiments(proposedFeature);
  await runValidateFeatureHooks({
    context,
    feature: proposedFeature,
    original: feature,
  });
  await runValidateFeatureRevisionHooks({
    context,
    feature,
    revision: {
      ...revision,
      ...computeRevisionPublishChanges(revision, context.auditUser, comment),
    },
    original: revision,
  });
}

export async function publishRevision({
  context,
  feature,
  revision,
  result,
  comment,
  bypassLockdown,
}: {
  context: ReqContext | ApiReqContext;
  feature: FeatureInterface;
  revision: FeatureRevisionInterface;
  result: MergeResultChanges;
  comment?: string;
  bypassLockdown?: boolean;
}) {
  if (revision.status === "published" || revision.status === "discarded") {
    throw new Error("Can only publish a draft revision");
  }

  if (!bypassLockdown) {
    await assertFeatureNotLockedByRamp(context, feature.id);

    // A sibling draft's "lock other drafts" schedule freezes other publishes.
    if (
      revision.version !== undefined &&
      (await hasPublishLockingScheduledSibling(
        context.org.id,
        feature.id,
        revision.version,
      ))
    ) {
      throw new Error(
        "Another draft of this feature is scheduled to publish and has locked publishing of other drafts. Cancel that schedule to publish this revision.",
      );
    }
  }

  // Run custom hooks before the side-effect writes below so a rejection doesn't orphan them
  await prevalidatePublishRevision({
    context,
    feature,
    revision,
    result,
    comment,
  });

  // Create ramp schedules BEFORE writing the feature so that a schedule
  // creation failure gates the publish (atomicity: no published feature without
  // its ramp schedule).
  const createActions = (revision.rampActions ?? []).filter(
    (a) => a.mode === "create",
  );
  const updateActions = (revision.rampActions ?? []).filter(
    (a) => a.mode === "update",
  );
  const preCreatedScheduleIds: string[] = [];
  if (createActions.length) {
    const ids = await createRampSchedulesForRevision(
      context,
      feature,
      revision,
      result,
      createActions,
    );
    preCreatedScheduleIds.push(...ids);
  }

  let updatedFeature: FeatureInterface;
  try {
    updatedFeature = await applyRevisionChanges(
      context,
      feature,
      revision,
      result,
    );

    if (result.holdout !== undefined) {
      await applyHoldoutSideEffects(context, feature, result.holdout);
    }

    await markRevisionAsPublished(
      context,
      feature,
      revision,
      context.auditUser,
      comment,
    );

    await clearPendingFeatureDraftsForRevision(
      context,
      revision.featureId,
      revision.version,
      revision.rules,
    );
  } catch (err) {
    // Roll back pre-created ramp schedules so they don't linger as orphans.
    for (const id of preCreatedScheduleIds) {
      try {
        await context.models.rampSchedules.deleteById(id);
      } catch (deleteErr) {
        logger.error(
          deleteErr,
          `Failed to delete orphaned ramp schedule ${id} during publish rollback`,
        );
      }
    }
    throw err;
  }

  // Apply deferred update actions after publish succeeds.
  // Best-effort: errors are logged but do not fail the publish response
  // (feature is already committed; a failed schedule update is recoverable).
  if (updateActions.length) {
    try {
      await createRampSchedulesForRevision(
        context,
        updatedFeature,
        revision,
        result,
        updateActions,
      );
    } catch (err) {
      logger.error(
        err,
        "Failed to apply deferred ramp update actions after publish",
      );
    }
  }

  // Apply detach actions (best-effort: logged but do not fail publish).
  if (revision.rampActions?.length) {
    await applyDetachRampActions(context, revision.rampActions);
  }

  // Clean up orphaned ramp schedules (best-effort).
  await cleanupOrphanedRampSchedules(context, feature, updatedFeature);

  return updatedFeature;
}

// Create a new revision from the given changes and immediately publish it.
// Either the revision is published and the updated feature is returned, or an
// error is thrown — a pending-review draft is never silently left behind.
// canBypassApprovalChecks should be true when the org-level restApiBypassesReviews
// setting is on, or when the caller's role/token grants bypassApprovalChecks
// on the feature's project.
export async function createAndPublishRevision({
  context,
  feature,
  user,
  org,
  changes,
  comment,
  canBypassApprovalChecks,
}: {
  context: ReqContext | ApiReqContext;
  feature: FeatureInterface;
  user: EventUser;
  org: OrganizationInterface;
  changes: Parameters<typeof createRevision>[0]["changes"];
  comment?: string;
  canBypassApprovalChecks: boolean;
}): Promise<{
  revision: FeatureRevisionInterface;
  updatedFeature: FeatureInterface;
}> {
  // Filter to envs applicable to this feature's project — avoids over-
  // triggering approval and creating dangling per-env settings.
  const orgEnvironments = getEnvironmentIdsFromOrg(org);
  const orgEnvObjects = getEnvironments(org);
  const applicableEnvIds = getApplicableEnvIds(orgEnvObjects, feature.project);
  const applicableEnvSet = new Set(applicableEnvIds);
  const allEnvironments = orgEnvironments.filter((e) =>
    applicableEnvSet.has(e),
  );

  // Determine whether the revision would require review before we create anything.
  // We need a synthetic revision to check against, mirroring what createRevision would build.
  const liveRevision = await getRevision({
    context,
    organization: feature.organization,
    featureId: feature.id,
    feature,
    version: feature.version,
  });
  if (!liveRevision) throw new Error("Could not load live revision");

  // Live baseline for the review check and the publish merge, built from the
  // feature document (the canonical live state). Stored revision docs can be
  // sparse or in legacy shapes, so they're not a reliable baseline.
  const liveBase: FeatureRevisionInterface = {
    ...liveRevision,
    ...liveRevisionFromFeature(liveRevision, feature),
  } as FeatureRevisionInterface;

  // Synthetic revision for the review check; caller-supplied rules replace
  // the live array wholesale (same as autoMerge).
  const syntheticRevision: FeatureRevisionInterface = {
    ...liveBase,
    ...(changes ?? {}),
    rules: changes?.rules ?? liveBase.rules ?? [],
  };
  const requiresReview = checkIfRevisionNeedsReview({
    feature,
    baseRevision: liveBase,
    revision: syntheticRevision,
    allEnvironments,
    settings: org.settings,
    requireApprovalsLicensed: context.hasPremiumFeature("require-approvals"),
  });

  if (requiresReview && !canBypassApprovalChecks) {
    throw new PermissionError(
      "This feature requires approval before changes can be published. " +
        "Enable 'REST API always bypasses approval requirements' in organization settings.",
    );
  }

  // Create the draft revision (never auto-publishes; publish=false).
  const revision = await createRevision({
    context,
    feature,
    user,
    baseVersion: feature.version,
    comment: comment ?? "Created via REST API",
    environments: allEnvironments,
    publish: false,
    changes,
    org,
    canBypassApprovalChecks,
  });

  // Merge the new revision against the live-feature baseline. base === live
  // for a fresh revision off HEAD.
  const mergeResult = autoMerge(
    liveBase,
    liveBase,
    revision,
    allEnvironments,
    {},
  );

  if (!mergeResult.success) {
    // Shouldn't happen for a brand-new revision off HEAD, but guard anyway.
    throw new Error(
      "Merge conflict detected while publishing revision. Please retry.",
    );
  }

  const updatedFeature = await publishRevision({
    context,
    feature,
    revision,
    result: mergeResult.result,
    comment,
    // See postFeatureRevisionPublish.ts for the bypassLockdown policy rationale:
    // approval-bypass permission intentionally doubles as ramp-lockdown bypass.
    bypassLockdown: canBypassApprovalChecks,
  });

  return { revision, updatedFeature };
}
