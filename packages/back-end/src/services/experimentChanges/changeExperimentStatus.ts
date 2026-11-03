import isEqual from "lodash/isEqual";
import {
  getAllVariations,
  getLaunchChecklistItems,
  sdkConnectionServesProject,
  withScheduledBy,
} from "shared/experiments";
import { getValidDate, resolveScheduledStop } from "shared/dates";
import { v4 as uuidv4 } from "uuid";
import { ScopedSettings } from "shared/settings";
import {
  ExperimentInterface,
  Changeset,
  ExperimentResultsType,
} from "shared/types/experiment";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import {
  ChecklistStatus,
  ExperimentStartChecklistStatus,
} from "shared/validators";
import { hasPendingScheduledStart, startBypassCovers } from "shared/util";
import { canBypassStartApproval } from "shared/permissions";
import { orgHasPremiumFeature } from "back-end/src/enterprise";
import {
  customHooksActive,
  runValidateExperimentHooks,
} from "back-end/src/enterprise/sandbox/sandbox-eval";
import { getExperimentLaunchChecklist } from "back-end/src/models/ExperimentLaunchChecklistModel";
import {
  getExperimentById,
  updateExperiment,
} from "back-end/src/models/ExperimentModel";
import { findSDKConnectionsByOrganization } from "back-end/src/models/SdkConnectionModel";
import { findVisualChangesetsByExperiment } from "back-end/src/models/VisualChangesetModel";
import { ReqContext } from "back-end/types/request";
import { flagBypass } from "back-end/src/services/featurePublishGates";
import {
  evaluateStartGates,
  rampLockedGate,
  startChecklistGates,
  type StartGate,
} from "back-end/src/services/experimentChanges/startGates";
import { ApiReqContext } from "back-end/types/api";
import {
  assertCanPublishPendingFeatureDrafts,
  assertCanRunExperimentInAffectedEnvironments,
  assertValidExperimentPhases,
  getChangesToStartExperiment,
  getLinkedFeatureInfo,
  resetExperimentBanditSettings,
} from "back-end/src/services/experiments";
import {
  formatPendingDraftFailureMessage,
  getLaunchDrafts,
  PendingDraftPublishResult,
  publishPendingFeatureDraftsForExperiment,
} from "back-end/src/services/experiment-feature";
import { getFeaturesByIds } from "back-end/src/models/FeatureModel";
import { getRevision } from "back-end/src/models/FeatureRevisionModel";
import {
  BadRequestError,
  ChecklistIncompleteError,
  ConflictError,
  InvalidStatusError,
  PendingDraftPublishFailedError,
} from "back-end/src/util/errors";
import {
  assertFeatureNotLockedByRamp,
  RampLockdownError,
} from "back-end/src/services/rampSchedule";
import { trackEventForContext } from "back-end/src/services/growthbook";
import { isArmingApiKeyId } from "back-end/src/util/armingApiKeyId";
import { assertScheduledStartAllowsChange } from "back-end/src/services/experimentChanges/scheduledStartLock";

export type StartChecklistItemStatus = {
  key: string;
  required: boolean;
  status: ChecklistStatus;
  manual: boolean;
  reason: string;
  hardBlock?: boolean;
  featureId?: string;
};

export type ExperimentStartChecklistResult = {
  experiment: ExperimentInterface;
  checklistItems: StartChecklistItemStatus[];
  gates: StartGate[];
  status: ExperimentStartChecklistStatus;
};

/** User-initiated experiment writes only. Start/schedule-start paths validate the would-be running state. */
export async function validateExperimentChange({
  context,
  experiment,
  changes,
}: {
  context: ReqContext | ApiReqContext;
  experiment: ExperimentInterface;
  changes: Changeset;
}): Promise<void> {
  assertScheduledStartAllowsChange(experiment, changes);
  if (!customHooksActive(context) || experiment.type === "holdout") return;

  const merged = { ...experiment, ...changes };
  const willRun =
    merged.status === "running" || hasPendingScheduledStart(merged);

  const effectiveChanges =
    willRun && experiment.status !== "running"
      ? { ...changes, ...(await getChangesToStartExperiment(context, merged)) }
      : changes;

  await runValidateExperimentHooks({
    context,
    experiment: { ...experiment, ...effectiveChanges },
    original: experiment,
  });
}

// Runs every check that can refuse and returns the change without writing it,
// so a caller can hold for confirmation first.
export async function planChecklistCompletion({
  context,
  experiment,
  keys,
}: {
  context: ReqContext;
  experiment: ExperimentInterface;
  keys: string[];
}): Promise<Changeset> {
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

  const changes: Changeset = { manualLaunchChecklist };
  await validateExperimentChange({ context, experiment, changes });
  return changes;
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
  dateEnded?: string | Date;
};

export type ModifyTemporaryRolloutInput = {
  experimentId: string;
  enableTemporaryRollout: boolean;
  releasedVariationId?: string;
};

export async function getExperimentStartChecklistStatus(
  context: ReqContext | ApiReqContext,
  experiment: ExperimentInterface,
  { arming = false }: { arming?: boolean } = {},
): Promise<StartChecklistItemStatus[]> {
  const [linkedFeatures, sdkConnections, visualChangesets, urlRedirects] =
    await Promise.all([
      getLinkedFeatureInfo(
        context,
        experiment,
        arming ? { publisher: context } : {},
      ),
      findSDKConnectionsByOrganization(context),
      findVisualChangesetsByExperiment(experiment.id, context.org.id),
      context.models.urlRedirects.findByExperiment(experiment.id),
    ]);
  const checklist = orgHasPremiumFeature(context.org, "custom-launch-checklist")
    ? (experiment.project &&
        (await getExperimentLaunchChecklist(
          context.org.id,
          experiment.project,
        ))) ||
      (await getExperimentLaunchChecklist(context.org.id, ""))
    : null;

  return getLaunchChecklistItems({
    experiment,
    linkedFeatures,
    visualChangesets,
    urlRedirects,
    sdkConnections: sdkConnections.filter((c) =>
      sdkConnectionServesProject(c, experiment.project),
    ),
    checklist,
  }).map(({ key, required, status, manual, label, hardBlock, featureId }) => ({
    key,
    required,
    status,
    manual,
    reason: label,
    ...(hardBlock ? { hardBlock } : {}),
    ...(featureId ? { featureId } : {}),
  }));
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

  await assertCanRunExperimentInAffectedEnvironments(context, experiment);

  return experiment;
}

// A stop ends the latest phase; a stopped experiment that runs or drafts again
// reopens it, or for a bandit starts a fresh phase with fresh buckets.
export function statusChangeEffects({
  experiment,
  status,
  settings,
  reason = "",
  dateEnded,
}: {
  experiment: ExperimentInterface;
  status: ExperimentInterface["status"];
  settings: ScopedSettings;
  reason?: string;
  dateEnded?: Date;
}): Changeset {
  const phases = [...experiment.phases];
  const last = phases.length - 1;
  if (last < 0) return {};
  if (
    experiment.status === "running" &&
    status === "stopped" &&
    !phases[last].dateEnded
  ) {
    phases[last] = {
      ...phases[last],
      reason,
      dateEnded: dateEnded ?? new Date(),
    };
    return { phases };
  }
  if (
    experiment.status !== "stopped" ||
    (status !== "running" && status !== "draft")
  ) {
    return {};
  }
  const reopened = { ...phases[last] };
  delete reopened.dateEnded;
  if (experiment.type !== "multi-armed-bandit") {
    phases[last] = reopened;
    return { phases };
  }
  phases[last] = { ...reopened, dateEnded: new Date() };
  phases.push({
    condition: reopened.condition,
    savedGroups: reopened.savedGroups,
    prerequisites: reopened.prerequisites,
    coverage: reopened.coverage,
    dateStarted: new Date(),
    name: "Main",
    namespace: reopened.namespace,
    reason: "",
    variationWeights: reopened.variationWeights,
    variations: reopened.variations,
    seed: uuidv4(),
  });
  const changes: Changeset = {
    phases,
    // Flush the sticky buckets.
    bucketVersion: (experiment.bucketVersion ?? 0) + 1,
    minBucketVersion: (experiment.bucketVersion ?? 0) + 1,
  };
  return {
    ...changes,
    ...resetExperimentBanditSettings({ experiment, changes, settings }),
  };
}

/**
 * Core experiment start — no permission checks, works from any context
 * (HTTP request or Agenda job). Publishes pending linked feature drafts
 * atomically with the status transition and throws if any draft fails.
 */
export async function executeExperimentStart(
  context: ReqContext | ApiReqContext,
  experiment: ExperimentInterface,
  bypassLockdown = false,
  restApiBypassesReviews = false,
): Promise<{
  updated: ExperimentInterface;
  publishResult: PendingDraftPublishResult;
}> {
  // Every linked flag, not only those with a draft to publish, as a scheduled
  // start fires here too. The bypass holds per flag.
  const linkedIds = experiment.linkedFeatures ?? [];
  const linked = bypassLockdown
    ? new Map(
        (await getFeaturesByIds(context, linkedIds)).map((f) => [f.id, f]),
      )
    : null;
  for (const fid of linkedIds) {
    const feature = linked?.get(fid);
    const bypass =
      !!feature &&
      flagBypass(context, feature, {
        optIn: bypassLockdown,
        restApiBypassesReviews,
      }).lockdown;
    if (!bypass) await assertFeatureNotLockedByRamp(context, fid);
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

  // Also checked on the write; here so a refused start publishes no drafts.
  assertValidExperimentPhases(
    changes.phases ?? experiment.phases,
    experiment.phases,
    true,
  );

  const publishResult = await publishPendingFeatureDraftsForExperiment(
    context,
    experiment,
    bypassLockdown,
    restApiBypassesReviews,
  );
  if (publishResult.failed.length > 0) {
    throw new PendingDraftPublishFailedError(
      formatPendingDraftFailureMessage(publishResult.failed),
      publishResult.failed,
    );
  }

  // Starting consumes any staged start. Resolve the scheduled end now that we
  // know the real start time: an absolute stopAt is used directly; a deferred
  // relative stopAfter is resolved to a concrete stopAt (start + offset) and
  // written back. If there's a future stop, stage it so the 1-minute job stops
  // (and applies shipping) at the cutoff; otherwise clear the staged update.
  const startedAt = new Date();
  const sched = experiment.statusUpdateSchedule;
  const { stopAt, stagedStop: nextScheduledStatusUpdate } =
    resolveScheduledStop({
      stopAt: sched?.stopAt,
      stopAfter: sched?.stopAfter,
      base: startedAt,
      active: true,
      now: startedAt,
    });
  // Persist the resolved concrete stop and drop the now-consumed relative
  // offset, so the stored schedule reflects the actual end going forward.
  if (sched?.stopAfter) {
    changes.statusUpdateSchedule = {
      ...(sched.startAt ? { startAt: sched.startAt } : {}),
      ...(stopAt ? { stopAt } : {}),
      ...(sched.scheduledStopPlan
        ? { scheduledStopPlan: sched.scheduledStopPlan }
        : {}),
    };
  }

  const updated = await updateExperiment({
    context,
    experiment,
    changes: {
      ...changes,
      // The job fires a start as its armer, so a stop derived here is theirs.
      nextScheduledStatusUpdate: withScheduledBy(
        nextScheduledStatusUpdate,
        context.armer,
      ),
    },
  });

  trackEventForContext(context, "Experiment Started", {
    source: context.auditUser?.type ?? "agenda-job",
    hasDatasource: !!updated.datasource,
    hasExperimentAssignmentQuery: !!updated.exposureQueryId,
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
  // An armed start is judged as it will be when it fires, as its armer.
  const { checklistItems, gates } = await planStartGates(context, experiment, {
    when: hasPendingScheduledStart(experiment) ? "fire" : "now",
  });
  return {
    experiment,
    checklistItems,
    gates,
    status: gates.length ? "notReady" : "ready",
  };
}

// The drafts a start would publish, each with its revision as it stands now.
async function launchDraftRevisions(
  context: ReqContext | ApiReqContext,
  experiment: ExperimentInterface,
) {
  const drafts: {
    featureId: string;
    revisionVersion: number;
    revision: FeatureRevisionInterface | null;
  }[] = [];
  for (const draft of await getLaunchDrafts(context, experiment)) {
    const revision = await getRevision({
      context,
      organization: context.org.id,
      featureId: draft.featureId,
      feature: undefined,
      version: draft.revisionVersion,
    });
    drafts.push({ ...draft, revision });
  }
  return drafts;
}

async function pinLaunchDrafts(
  context: ReqContext | ApiReqContext,
  experiment: ExperimentInterface,
) {
  return (await launchDraftRevisions(context, experiment)).flatMap(
    ({ featureId, revisionVersion, revision }) =>
      revision
        ? [{ featureId, revisionVersion, dateUpdated: revision.dateUpdated }]
        : [],
  );
}

// The armer may still bypass, and each draft it would publish is the one pinned
// when armed. A draft that changed since needs approving like any other.
export async function armedStartBypassStands(
  armer: ReqContext | ApiReqContext,
  experiment: ExperimentInterface,
): Promise<boolean> {
  const staged = experiment.nextScheduledStatusUpdate;
  if (staged?.type !== "start" || !staged.bypassApproval) return false;
  if (!armer.permissions.canBypassFlagApprovalChecks(experiment, "feature")) {
    return false;
  }
  return (await launchDraftRevisions(armer, experiment)).every(
    ({ featureId, revisionVersion, revision }) =>
      startBypassCovers(experiment, featureId, {
        version: revisionVersion,
        dateUpdated: revision?.dateUpdated,
      }),
  );
}

export type StartPlan = {
  checklistItems: StartChecklistItemStatus[];
  gates: StartGate[];
} & ReturnType<typeof evaluateStartGates>;

// What starting now, arming a scheduled start, or that start firing faces, as
// publish gates.
export async function planStartGates(
  context: ReqContext | ApiReqContext,
  experiment: ExperimentInterface,
  {
    when,
    skipChecklist = false,
    bypassApproval = false,
    restApiBypassesReviews = false,
  }: {
    when: "now" | "arm" | "fire";
    skipChecklist?: boolean;
    // Asks for the caller's approval bypass, judged per flag.
    bypassApproval?: boolean;
    // Starting now only: it doesn't carry to a staged start.
    restApiBypassesReviews?: boolean;
  },
): Promise<StartPlan> {
  const checklistItems = await getExperimentStartChecklistStatus(
    context,
    experiment,
    { arming: when !== "fire" },
  );
  const gates = startChecklistGates(
    experiment.id,
    checklistItems,
    new Map(
      (await getLaunchDrafts(context, experiment)).map((d) => [
        d.featureId,
        d.revisionVersion,
      ]),
    ),
  );
  for (const featureId of experiment.linkedFeatures ?? []) {
    try {
      await assertFeatureNotLockedByRamp(context, featureId);
    } catch (e) {
      if (!(e instanceof RampLockdownError)) throw e;
      gates.push(rampLockedGate(featureId, e.message));
    }
  }
  const flagIds = [...new Set(gates.flatMap((g) => g.featureId ?? []))];
  const features = new Map(
    bypassApproval && flagIds.length
      ? (await getFeaturesByIds(context, flagIds)).map((f) => [f.id, f])
      : [],
  );
  return {
    checklistItems,
    gates,
    ...evaluateStartGates(gates, {
      skipChecklist,
      canBypassFlag: (featureId) => {
        const feature = features.get(featureId);
        return (
          !!feature &&
          canBypassStartApproval(context.permissions, experiment, feature)
        );
      },
      restApiBypassesReviews: when === "now" && restApiBypassesReviews,
    }),
  };
}

// What a REST start reports: what it got past, and the drafts it published.
export function startResult(
  plan: StartPlan,
  publishedFeatureDrafts: { featureId: string; revisionVersion: number }[] = [],
) {
  return {
    ...(plan.skipped.length
      ? {
          bypassedGates: plan.skipped.map(({ key, type, via }) => ({
            key,
            type,
            outcome: "bypassed" as const,
            via,
          })),
        }
      : {}),
    ...(publishedFeatureDrafts.length ? { publishedFeatureDrafts } : {}),
  };
}

export function assertStartNotBlocked(plan: StartPlan): void {
  if (!plan.blocking.length) return;
  const keys = new Set(plan.blocking.map((gate) => gate.key));
  const hard = plan.blocking.filter((gate) => !gate.override);
  throw new ChecklistIncompleteError(
    hard.length === 1
      ? `Experiment cannot be started: ${hard[0].messages[0]}`
      : hard.length
        ? "Experiment cannot be started: linked feature draft issues must be resolved and cannot be bypassed"
        : "Experiment cannot be started: required checklist items are incomplete",
    plan.checklistItems.filter((item) => keys.has(item.key)),
    plan.blocking,
  );
}

export async function assertStartAllowed(
  context: ReqContext | ApiReqContext,
  experiment: ExperimentInterface,
  options: Parameters<typeof planStartGates>[2],
): Promise<StartPlan> {
  await assertCanPublishPendingFeatureDrafts(context, experiment);
  const plan = await planStartGates(context, experiment, options);
  assertStartNotBlocked(plan);
  return plan;
}

// Run when a scheduled start fires. The approver already acknowledged the soft items.
export async function assertScheduledStartNotHardBlocked(
  context: ReqContext | ApiReqContext,
  experiment: ExperimentInterface,
  bypassApproval = false,
): Promise<void> {
  assertStartNotBlocked(
    await planStartGates(context, experiment, {
      when: "fire",
      skipChecklist: true,
      bypassApproval,
    }),
  );
}

// Once a start goes ahead, every item still open was skipped or waived by the bypass.
export function getStartAcknowledgment({
  checklistItems,
  skipChecklist,
  bypassLockdown,
}: {
  checklistItems: StartChecklistItemStatus[];
  skipChecklist: boolean;
  bypassLockdown: boolean;
}) {
  return {
    skipChecklist,
    bypassLockdown,
    skippedChecklistItems: checklistItems
      .filter((item) => item.status === "incomplete")
      .map((item) => item.key),
  };
}

export async function startExperiment({
  context,
  experimentId,
  skipChecklist = false,
  bypassLockdown = false,
  restApiBypassesReviews = false,
  plan: checked,
}: {
  context: ReqContext;
  experimentId: string;
  skipChecklist?: boolean;
  restApiBypassesReviews?: boolean;
  // Caller must verify admin-bypass permissions first; it is re-checked per flag.
  bypassLockdown?: boolean;
  // What the caller checked and confirmed; the start may bypass no more.
  plan?: StartPlan;
}) {
  const experiment = await loadAndValidateExperimentForStatusChange(
    context,
    experimentId,
  );
  if (experiment.status !== "draft") {
    throw new InvalidStatusError(
      "Experiment must be in draft status",
      experiment.status,
      ["draft"],
    );
  }
  // Planned on what it publishes now, even after the caller's check: a draft
  // changed since can't ride along unchecked, nor bypass more than it did.
  const plan = await assertStartAllowed(context, experiment, {
    when: "now",
    skipChecklist,
    bypassApproval: bypassLockdown,
    restApiBypassesReviews,
  });
  if (checked && !isEqual(plan.bypassed, checked.bypassed)) {
    throw new ConflictError(
      "Its Feature Flag drafts changed while it was starting. Try again.",
    );
  }

  const { updated, publishResult } = await executeExperimentStart(
    context,
    experiment,
    bypassLockdown,
    restApiBypassesReviews,
  );

  return {
    experiment,
    updated,
    checklistItems: plan.checklistItems,
    plan,
    publishedFeatureDrafts: publishResult.published,
  };
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
  bypassApproval = false,
  plan: checked,
}: {
  context: ReqContext;
  experimentId: string;
  skipChecklist?: boolean;
  // Arms the start past its flag drafts' approvals, where the armer may bypass.
  bypassApproval?: boolean;
  // What the caller already checked this arming against, in this request.
  plan?: StartPlan;
}) {
  const experiment = await loadAndValidateExperimentForStatusChange(
    context,
    experimentId,
  );

  if (experiment.status !== "draft") {
    throw new InvalidStatusError(
      "Experiment must be in draft status to approve a scheduled start",
      experiment.status,
      ["draft"],
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

  const bypass =
    bypassApproval &&
    context.permissions.canBypassFlagApprovalChecks(experiment, "feature");
  const plan =
    checked ??
    (await assertStartAllowed(context, experiment, {
      when: "arm",
      skipChecklist,
      bypassApproval: bypass,
    }));

  // The fire runs as the armer, so there has to be one to record.
  if (!context.userId && !isArmingApiKeyId(context.apiKey)) {
    throw new BadRequestError(
      "A scheduled start must be armed by a user or an org API key",
    );
  }
  const changes: Changeset = {
    nextScheduledStatusUpdate: withScheduledBy(
      {
        type: "start" as const,
        date: startAt,
        ...(bypass
          ? {
              bypassApproval: true,
              pinnedDrafts: await pinLaunchDrafts(context, experiment),
            }
          : {}),
      },
      context.armer,
    ),
  };
  await validateExperimentChange({ context, experiment, changes });
  const updated = await updateExperiment({
    context,
    experiment,
    changes,
  });

  return {
    experiment,
    updated,
    checklistItems: plan.checklistItems,
    plan,
    bypassApproval: bypass,
  };
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

  const changes: Changeset = {
    nextScheduledStatusUpdate: null,
  };

  const updated = await updateExperiment({
    context,
    experiment,
    changes,
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

  const expectedStopStatuses = allowAlreadyStopped
    ? ["running", "stopped"]
    : ["running"];
  if (!expectedStopStatuses.includes(experiment.status)) {
    throw new InvalidStatusError(
      `Can only stop an experiment in ${expectedStopStatuses.join(" or ")} status`,
      experiment.status,
      expectedStopStatuses,
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

  if (experiment.nextScheduledStatusUpdate) {
    changes.nextScheduledStatusUpdate = null;
  }

  if (experiment.type === "multi-armed-bandit") {
    changes.banditStage = "paused";
    changes.banditStageDateStarted = new Date();
  }

  await validateExperimentChange({ context, experiment, changes });
  const updated = await updateExperiment({
    context,
    experiment,
    changes,
  });

  if (isEnding) {
    // Only track true stop events; ignore results edits to already-stopped
    // experiments.
    trackEventForContext(context, "Experiment Stopped", {
      source: context.auditUser?.type ?? "agenda-job",
      result: updated.results,
    });
  }

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
    throw new InvalidStatusError(
      "Can only modify temporary rollout for stopped experiments",
      experiment.status,
      ["stopped"],
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

  await validateExperimentChange({ context, experiment, changes });
  const updated = await updateExperiment({
    context,
    experiment,
    changes,
  });

  return { experiment, updated };
}
