/**
 * Experiment Ramp Schedule Service
 *
 * Handles ramp schedule operations specific to experiments: coverage changes,
 * rollback (new phase + rerandomization + bucket version increment), and end
 * strategy execution. These functions are called by the generic ramp schedule
 * machinery when it detects entityType === "experiment".
 */
import {
  AutoRollbackMode,
  ExperimentEndStrategy,
  ExperimentInterface,
  ExperimentPatch,
  ExperimentPhase,
  RampProgressionMode,
  RampScheduleInterface,
  ShippingCriteriaMode,
} from "shared/validators";
import {
  getMidRampDecisionStatus,
  getHealthSettings,
  getExperimentResultStatus,
  PRESET_DECISION_CRITERIA,
  PRESET_DECISION_CRITERIAS,
  DecisionCriteriaData,
  DEFAULT_DC_HEALTH_SIGNALS,
  DcHealthSignals,
} from "shared/enterprise";
import { getSRMHealthData, getMultipleExposureHealthData } from "shared/health";
import {
  DEFAULT_SRM_MINIMINUM_COUNT_PER_VARIATION,
  DEFAULT_MULTIPLE_EXPOSURES_ENOUGH_DATA_THRESHOLD,
} from "shared/constants";
import { expandMetricGroups } from "shared/experiments";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import { updateExperiment } from "back-end/src/models/ExperimentModel";
import { findSnapshotById } from "back-end/src/models/ExperimentSnapshotModel";
import { EvalDecision } from "back-end/src/services/rampScheduleEvaluator";

// ---------------------------------------------------------------------------
// Decision criteria helper
// ---------------------------------------------------------------------------

export async function resolveDecisionCriteria(
  ctx: ReqContext | ApiReqContext,
  experiment: ExperimentInterface,
): Promise<DecisionCriteriaData> {
  const id =
    experiment.decisionFrameworkSettings?.decisionCriteriaId ??
    ctx.org.settings?.defaultDecisionCriteriaId;

  let dc: DecisionCriteriaData;
  if (!id) {
    dc = PRESET_DECISION_CRITERIA;
  } else {
    const preset = PRESET_DECISION_CRITERIAS.find((p) => p.id === id);
    if (preset) {
      dc = preset;
    } else {
      const stored = await ctx.models.decisionCriteria.getById(id);
      dc = stored ?? PRESET_DECISION_CRITERIA;
    }
  }

  // JIT migration: ensure healthSignals is always populated
  if (!dc.healthSignals) {
    dc = { ...dc, healthSignals: { ...DEFAULT_DC_HEALTH_SIGNALS } };
  }
  return dc;
}

/**
 * Resolves the health signal configuration from the experiment's DC.
 * Convenience wrapper for callers that only need health signals.
 */
export async function resolveHealthSignals(
  ctx: ReqContext | ApiReqContext,
  experiment: ExperimentInterface,
): Promise<DcHealthSignals> {
  const dc = await resolveDecisionCriteria(ctx, experiment);
  return dc.healthSignals ?? { ...DEFAULT_DC_HEALTH_SIGNALS };
}

// ---------------------------------------------------------------------------
// Coverage / phase changes
// ---------------------------------------------------------------------------

/**
 * Apply an experiment patch from a ramp step to the live experiment.
 *
 * Simple mode (newPhase !== true): mutates the last phase's coverage
 * in-place. No rerandomization, analysis window continues.
 *
 * Full phase mode (newPhase === true): ends the current last phase and
 * pushes a new one with the patched values.
 */
export async function applyExperimentCoverageChange(
  ctx: ReqContext | ApiReqContext,
  experiment: ExperimentInterface,
  patch: ExperimentPatch,
  stepLabel: string,
): Promise<ExperimentInterface> {
  const phases = [...experiment.phases];
  const lastIdx = phases.length - 1;

  const targetingOverrides: Partial<ExperimentPhase> = {};
  if (patch.condition !== null && patch.condition !== undefined) {
    targetingOverrides.condition = patch.condition;
  }
  if (patch.savedGroups !== null && patch.savedGroups !== undefined) {
    targetingOverrides.savedGroups = patch.savedGroups;
  }
  if (patch.prerequisites !== null && patch.prerequisites !== undefined) {
    targetingOverrides.prerequisites = patch.prerequisites;
  }

  const experimentLevelChanges: Partial<ExperimentInterface> = {};

  if (patch.reseed) {
    targetingOverrides.seed = generatePhaseSeed();
  }
  if (patch.bumpBucketVersion) {
    const next = (experiment.bucketVersion ?? 0) + 1;
    experimentLevelChanges.bucketVersion = next;
    if (patch.blockPriorBucketed) {
      experimentLevelChanges.minBucketVersion = next;
    }
  }

  if (patch.newPhase) {
    const now = new Date();
    const lastPhase = phases[lastIdx];
    if (lastPhase) {
      phases[lastIdx] = { ...lastPhase, dateEnded: now };
    }
    const newPhase: ExperimentPhase = {
      ...(lastPhase ?? {}),
      dateStarted: now,
      dateEnded: undefined,
      name: stepLabel,
      reason: `Ramp step: ${stepLabel}`,
      ...(patch.coverage !== null && patch.coverage !== undefined
        ? { coverage: patch.coverage }
        : {}),
      ...(patch.variationWeights
        ? { variationWeights: patch.variationWeights }
        : {}),
      ...targetingOverrides,
    };
    phases.push(newPhase);
    return updateExperiment({
      context: ctx,
      experiment,
      changes: { phases, ...experimentLevelChanges },
    });
  }

  // Simple in-place update: patch coverage/weights/targeting in last phase.
  const last = phases[lastIdx];
  if (!last) {
    throw new Error(
      `Experiment ${experiment.id} has no phases — cannot apply coverage change`,
    );
  }
  const updated: ExperimentPhase = {
    ...last,
    ...(patch.coverage !== null && patch.coverage !== undefined
      ? { coverage: patch.coverage }
      : {}),
    ...(patch.variationWeights
      ? { variationWeights: patch.variationWeights }
      : {}),
    ...targetingOverrides,
  };
  phases[lastIdx] = updated;

  return updateExperiment({
    context: ctx,
    experiment,
    changes: { phases, ...experimentLevelChanges },
  });
}

function generatePhaseSeed(): string {
  return Math.random().toString(36).substring(2, 10);
}

// ---------------------------------------------------------------------------
// Rollback
// ---------------------------------------------------------------------------

/**
 * Rollback an experiment ramp. Always starts a new reverting phase with the
 * pre-ramp snapshot state captured in schedule.startActions. Rerandomizes by
 * generating a new phase seed and increments bucketVersion to eject all sticky
 * buckets, ensuring users who were exposed to the bad variation are reassigned.
 */
export async function applyExperimentRollback(
  ctx: ReqContext | ApiReqContext,
  experiment: ExperimentInterface,
  schedule: RampScheduleInterface,
): Promise<ExperimentInterface> {
  const now = new Date();
  const phases = [...experiment.phases];
  const lastIdx = phases.length - 1;
  const lastPhase = phases[lastIdx];

  // Find the pre-ramp snapshot from startActions
  const startAction = schedule.startActions?.find(
    (a) => a.targetType === "experiment",
  );
  const preRampPatch =
    startAction?.targetType === "experiment" ? startAction.patch : null;

  // End the current phase
  if (lastPhase) {
    phases[lastIdx] = { ...lastPhase, dateEnded: now };
  }

  // Build the reverting phase from pre-ramp state
  const revertPhase: ExperimentPhase = {
    ...(lastPhase ?? {}),
    dateStarted: now,
    dateEnded: undefined,
    name: "Reverted (ramp rollback)",
    reason: `Ramp rolled back: ${schedule.lastRollbackReason ?? "manual"}`,
    // Restore pre-ramp coverage and weights if captured
    ...(preRampPatch?.coverage !== null && preRampPatch?.coverage !== undefined
      ? { coverage: preRampPatch.coverage }
      : {}),
    ...(preRampPatch?.variationWeights
      ? { variationWeights: preRampPatch.variationWeights }
      : {}),
    // Restore pre-ramp targeting if captured
    ...(preRampPatch?.condition !== null &&
    preRampPatch?.condition !== undefined
      ? { condition: preRampPatch.condition }
      : {}),
    ...(preRampPatch?.savedGroups
      ? { savedGroups: preRampPatch.savedGroups }
      : {}),
    ...(preRampPatch?.prerequisites
      ? { prerequisites: preRampPatch.prerequisites }
      : {}),
    // Fresh seed for rerandomization — intentionally NOT restoring the
    // original seed, which would rebucket some users back into the bad arm.
    seed: `rollback-${now.getTime()}`,
  };
  phases.push(revertPhase);

  // Increment bucketVersion to eject all sticky bucket assignments.
  // Also increment minBucketVersion if the schedule's rollback behavior
  // requires excluding previously exposed users.
  const newBucketVersion = (experiment.bucketVersion ?? 0) + 1;

  return updateExperiment({
    context: ctx,
    experiment,
    changes: {
      phases,
      bucketVersion: newBucketVersion,
      // minBucketVersion stays as-is by default (reassign, don't exclude).
      // The "exclude previously exposed users" option bumps this too — handled
      // by the caller passing a separate update if opted in.
    },
  });
}

// ---------------------------------------------------------------------------
// End strategy
// ---------------------------------------------------------------------------

function resolveAutoRollbackMode(
  experiment: ExperimentInterface,
  org: { settings?: { defaultAutoRollbackMode?: AutoRollbackMode } },
): AutoRollbackMode {
  return (
    experiment.autoRollbackMode ??
    org.settings?.defaultAutoRollbackMode ??
    "off"
  );
}

function autoRollbackMetric(mode: AutoRollbackMode): boolean {
  return mode === "all";
}

function autoRollbackHealth(mode: AutoRollbackMode): boolean {
  return mode === "all" || mode === "health-only";
}

function resolveRampProgressionMode(
  experiment: ExperimentInterface,
  org: { settings?: { defaultRampProgressionMode?: RampProgressionMode } },
): RampProgressionMode {
  return (
    experiment.rampProgressionMode ??
    org.settings?.defaultRampProgressionMode ??
    "hold-for-health"
  );
}

/**
 * Returns true if any health signal is currently failing AND
 * rampProgressionMode is not "ignore". Used to block soft
 * end-date auto-actions and ramp advancement.
 */
async function isHealthHolding(
  ctx: ReqContext | ApiReqContext,
  experiment: ExperimentInterface,
): Promise<boolean> {
  if (resolveRampProgressionMode(experiment, ctx.org) === "ignore")
    return false;

  const hs = await resolveHealthSignals(ctx, experiment);

  const summary = experiment.analysisSummary;
  const health = summary?.health;
  if (!health) return false;

  const healthSettings = getHealthSettings(ctx.org.settings);
  const totalUsers = health.totalUsers ?? 0;

  if (hs.srmAction !== "off") {
    const srmData = getSRMHealthData({
      srm: health.srm,
      srmThreshold: healthSettings.srmThreshold,
      totalUsersCount: totalUsers,
      numOfVariations: experiment.variations.length,
      minUsersPerVariation: DEFAULT_SRM_MINIMINUM_COUNT_PER_VARIATION,
    });
    if (srmData === "unhealthy") return true;
  }

  if (hs.multipleExposureAction !== "off") {
    const meData = getMultipleExposureHealthData({
      multipleExposuresCount: health.multipleExposures ?? 0,
      totalUsersCount: totalUsers,
      minCountThreshold: DEFAULT_MULTIPLE_EXPOSURES_ENOUGH_DATA_THRESHOLD,
      minPercentThreshold: healthSettings.multipleExposureMinPercent,
    });
    if (meData.status === "unhealthy") return true;
  }

  return false;
}

/**
 * Execute an experiment end strategy when the ramp completes or a hard date
 * is reached. Drives the experiment to a terminal state based on the strategy type.
 */
export async function applyExperimentEndStrategy(
  ctx: ReqContext | ApiReqContext,
  experiment: ExperimentInterface,
  strategy: ExperimentEndStrategy,
): Promise<ExperimentInterface> {
  switch (strategy.type) {
    case "soft":
      // No automatic action — surface as a CTA in the UI.
      return experiment;

    case "soft-edf": {
      // Evaluate the EDF decision up front. A metric-driven rollback is the
      // safe (revert-to-baseline) direction, so it must fire even when a health
      // signal is holding — only forward shipping is deferred by the hold.
      const decisionCriteria = await resolveDecisionCriteria(ctx, experiment);
      const healthSettings = getHealthSettings(ctx.org.settings);

      const status = getExperimentResultStatus({
        experimentData: experiment,
        healthSettings,
        decisionCriteria,
      });

      if (status?.status === "rollback-now") {
        const mode = resolveAutoRollbackMode(experiment, ctx.org);
        if (autoRollbackMetric(mode)) {
          return updateExperiment({
            context: ctx,
            experiment,
            changes: {
              status: "stopped",
              results: "lost",
            },
          });
        }
        // Rollback not auto-enabled — surface for manual review.
        return experiment;
      }

      // A failing health signal means the assignment/data is suspect, so defer
      // forward shipping for manual review. (Rollback is handled above, since
      // reverting to baseline is safe even on suspect data.)
      if (await isHealthHolding(ctx, experiment)) return experiment;

      if (status?.status === "ship-now") {
        const winVariationId =
          status.variations[0]?.variationId ?? strategy.plannedVariationId;
        return updateExperiment({
          context: ctx,
          experiment,
          changes: {
            status: "stopped",
            results: "won",
            winner:
              winVariationId !== undefined
                ? parseInt(winVariationId, 10)
                : undefined,
            releasedVariationId: winVariationId ?? "",
          },
        });
      }
      // Inconclusive — surface for manual review.
      return experiment;
    }

    case "hard-planned": {
      // Auto-rollout with fallback: check EDF for a clear winner first,
      // fall back to the planned variation if inconclusive or no data.
      const dcHP = await resolveDecisionCriteria(ctx, experiment);
      const hsHP = getHealthSettings(ctx.org.settings);
      const statusHP = getExperimentResultStatus({
        experimentData: experiment,
        healthSettings: hsHP,
        decisionCriteria: dcHP,
      });

      const shipVariationId =
        statusHP?.status === "ship-now"
          ? (statusHP.variations[0]?.variationId ?? strategy.plannedVariationId)
          : strategy.plannedVariationId;

      const isControl =
        shipVariationId === "0" ||
        shipVariationId === experiment.variations[0]?.id;
      return updateExperiment({
        context: ctx,
        experiment,
        changes: {
          status: "stopped",
          results: isControl ? "dnf" : "won",
          winner: isControl
            ? 0
            : experiment.variations.findIndex((v) => v.id === shipVariationId),
          releasedVariationId: shipVariationId ?? "",
        },
      });
    }
  }
}

// Resolve the effective shipping mode: experiment override, else org default,
// else "off".
export function resolveShippingMode(
  experiment: ExperimentInterface,
  org: { settings?: { defaultShippingCriteriaMode?: ShippingCriteriaMode } },
): ShippingCriteriaMode {
  return (
    experiment.shippingCriteria?.mode ??
    org.settings?.defaultShippingCriteriaMode ??
    "off"
  );
}

/**
 * Apply an experiment's shippingCriteria as an auto-ship decision. Shared by
 * the non-ramp stopAt-driven path (evaluateShippingCriteria) and ramp
 * completion (completeRollout). The CALLER owns the trigger (stop date vs ramp
 * completion); this function owns the mode→strategy mapping + min-runtime gate.
 * No-op unless the experiment is running and a non-"off" mode is configured.
 */
export async function applyShippingCriteria(
  ctx: ReqContext | ApiReqContext,
  experiment: ExperimentInterface,
): Promise<void> {
  if (experiment.status !== "running") return;

  const mode = resolveShippingMode(experiment, ctx.org);
  if (mode === "off") return;

  // Don't auto-ship before the experiment has run its minimum required time.
  const minimumRuntimeDays = experiment.shippingCriteria?.minimumRuntimeDays;
  if (minimumRuntimeDays) {
    const lastPhaseStart =
      experiment.phases?.[experiment.phases.length - 1]?.dateStarted;
    if (lastPhaseStart) {
      const runtimeDays =
        (Date.now() - new Date(lastPhaseStart).getTime()) /
        (1000 * 60 * 60 * 24);
      if (runtimeDays < minimumRuntimeDays) return;
    }
  }

  if (mode === "auto") {
    await applyExperimentEndStrategy(ctx, experiment, {
      type: "soft-edf",
      plannedVariationId: experiment.shippingCriteria?.plannedVariationId,
      minimumRuntimeDays,
    });
    return;
  }

  // auto-force
  const plannedVariationId =
    experiment.shippingCriteria?.plannedVariationId ??
    experiment.variations[0]?.id;
  if (!plannedVariationId) return;
  await applyExperimentEndStrategy(ctx, experiment, {
    type: "hard-planned",
    plannedVariationId,
    minimumRuntimeDays,
  });
}

// ---------------------------------------------------------------------------
// Mid-ramp EDF evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluate the current experiment ramp step by reading directly from the
 * experiment's analysisSummary (no SafeRollout backing entity needed).
 *
 * Gate order (same as feature ramp monitored steps):
 *  1. Interval elapsed
 *  2. Fresh post-interval snapshot available
 *  3. No-traffic grace period / no-data
 *  4. Health signals (SRM, multiple exposures) per DC health rules
 *  5. EDF mid-ramp decision (super-stat-sig via getMidRampDecisionStatus)
 *  6. Minimum sample size
 *  7. Approval gate (final)
 *
 * Health signal actions come from the experiment's Decision Criteria.
 * Execution is gated by `autoRollbackMode` and `rampProgressionMode`.
 */
export async function evaluateExperimentRampStep(
  ctx: ReqContext | ApiReqContext,
  schedule: RampScheduleInterface,
  experiment: ExperimentInterface,
  now: Date,
): Promise<EvalDecision> {
  const step = schedule.steps[schedule.currentStepIndex];
  if (!step) return { action: "advance" };

  const hs = await resolveHealthSignals(ctx, experiment);

  // 1. Interval gate
  const stepEnteredAt = schedule.currentStepEnteredAt;
  const stepIntervalSeconds = step.interval ?? null;
  if (stepEnteredAt && stepIntervalSeconds !== null) {
    const stepElapsedMs = now.getTime() - stepEnteredAt.getTime();
    const stepDurationMs = stepIntervalSeconds * 1000;
    if (stepElapsedMs < stepDurationMs) {
      const remainingMin = Math.ceil((stepDurationMs - stepElapsedMs) / 60_000);
      return {
        action: "hold",
        reason: `Experiment ramp: ~${remainingMin} min remaining in hold interval`,
        nextProcessAt: new Date(stepEnteredAt.getTime() + stepDurationMs),
      };
    }
  }

  // 2. Snapshot freshness gate
  const intervalEndAt =
    stepEnteredAt && stepIntervalSeconds !== null
      ? new Date(stepEnteredAt.getTime() + stepIntervalSeconds * 1000)
      : null;
  const requiredSnapshotAt =
    intervalEndAt ?? stepEnteredAt ?? schedule.startedAt;

  const summary = experiment.analysisSummary;
  const snapshotId = summary?.snapshotId;

  if (requiredSnapshotAt && !snapshotId) {
    return {
      action: "hold",
      reason: "Waiting for initial analysis snapshot",
    };
  }

  if (requiredSnapshotAt && snapshotId) {
    // We need a snapshot created AFTER the required time. Look up the snapshot
    // to check its creation date.
    const snap = await findSnapshotById(ctx, snapshotId);
    const snapCreatedAt = snap?.dateCreated ? new Date(snap.dateCreated) : null;
    if (!snapCreatedAt || snapCreatedAt < requiredSnapshotAt) {
      return {
        action: "hold",
        reason:
          "Waiting for analysis results that cover the current monitored step",
        nextProcessAt: experiment.nextSnapshotAttempt ?? null,
      };
    }
  }

  const health = summary?.health;
  if (!health) {
    return { action: "hold", reason: "Waiting for analysis results" };
  }
  const totalUsers = health.totalUsers ?? 0;

  // 3–4. No-traffic gate (runs before other health checks: zero users makes
  //      downstream analyses unreliable)
  if (!health.totalUsers && hs.noTrafficAction !== "off") {
    const monitoringStartDate =
      schedule.monitoringStartDate ??
      schedule.currentStepEnteredAt ??
      schedule.startedAt;
    if (monitoringStartDate) {
      const gracePeriodHours = hs.noTrafficGracePeriodHours;
      const gracePeriodMs = gracePeriodHours * 60 * 60 * 1000;
      const elapsedMs = now.getTime() - monitoringStartDate.getTime();
      if (elapsedMs < gracePeriodMs) {
        const remainingMin = Math.ceil((gracePeriodMs - elapsedMs) / 60_000);
        return {
          action: "hold",
          reason: `No traffic yet — waiting for ${gracePeriodHours}h grace period (~${remainingMin} min remaining)`,
          nextProcessAt: new Date(
            monitoringStartDate.getTime() + gracePeriodMs,
          ),
        };
      }
    }
    {
      const mode = resolveAutoRollbackMode(experiment, ctx.org);
      if (hs.noTrafficAction === "rollback" && autoRollbackHealth(mode)) {
        return {
          action: "rollback",
          reason: "No traffic detected — rolling back",
        };
      }
    }
    const holdForHealth =
      resolveRampProgressionMode(experiment, ctx.org) !== "ignore";
    if (holdForHealth) {
      return {
        action: "hold",
        reason: "No traffic detected — holding until traffic arrives",
      };
    }
  }

  // 3. SRM and multiple-exposure health checks
  {
    const healthSettings = getHealthSettings(ctx.org.settings);

    const rollbackMode = resolveAutoRollbackMode(experiment, ctx.org);
    const healthRollback = autoRollbackHealth(rollbackMode);
    const holdForHealth =
      resolveRampProgressionMode(experiment, ctx.org) !== "ignore";

    if (hs.srmAction !== "off") {
      const srmData = getSRMHealthData({
        srm: health.srm,
        srmThreshold: healthSettings.srmThreshold,
        totalUsersCount: totalUsers,
        numOfVariations:
          summary?.resultsStatus?.variations?.length ??
          experiment.variations.length,
        minUsersPerVariation: DEFAULT_SRM_MINIMINUM_COUNT_PER_VARIATION,
      });

      if (srmData === "unhealthy") {
        if (hs.srmAction === "rollback" && healthRollback) {
          return {
            action: "rollback",
            reason: `SRM check failed (p=${health.srm?.toFixed(4) ?? "?"})`,
          };
        }
        if (holdForHealth) {
          return {
            action: "hold",
            reason: `SRM check failed — holding (p=${health.srm?.toFixed(4) ?? "?"})`,
          };
        }
      }
    }

    if (hs.multipleExposureAction !== "off") {
      const meData = getMultipleExposureHealthData({
        multipleExposuresCount: health.multipleExposures ?? 0,
        totalUsersCount: totalUsers,
        minCountThreshold: DEFAULT_MULTIPLE_EXPOSURES_ENOUGH_DATA_THRESHOLD,
        minPercentThreshold: healthSettings.multipleExposureMinPercent,
      });

      if (meData.status === "unhealthy") {
        if (hs.multipleExposureAction === "rollback" && healthRollback) {
          return {
            action: "rollback",
            reason: `Multiple exposures detected (${(meData.rawDecimal * 100).toFixed(1)}% of users)`,
          };
        }
        if (holdForHealth) {
          return {
            action: "hold",
            reason: `Multiple exposures detected — holding (${(meData.rawDecimal * 100).toFixed(1)}% of users)`,
          };
        }
      }
    }
  }

  // 5. EDF mid-ramp gate — metric DC rules produce rollback-now / review-now
  //    / ship-now. Gated by autoRollbackMode. review-now is notification-only.
  const resultsStatus = summary?.resultsStatus;
  if (resultsStatus) {
    const decisionCriteria = await resolveDecisionCriteria(ctx, experiment);
    const metricGroups = await ctx.models.metricGroups.getAll();
    const goalMetrics = expandMetricGroups(
      experiment.goalMetrics ?? [],
      metricGroups,
    );
    const guardrailMetrics = expandMetricGroups(
      experiment.guardrailMetrics ?? [],
      metricGroups,
    );

    const midRampStatus = getMidRampDecisionStatus({
      resultsStatus,
      decisionCriteria,
      goalMetrics,
      guardrailMetrics,
    });

    if (midRampStatus) {
      if (midRampStatus.status === "rollback-now") {
        if (autoRollbackMetric(resolveAutoRollbackMode(experiment, ctx.org))) {
          return {
            action: "rollback",
            reason:
              "EDF: rollback-now — auto-rolling back per decision criteria",
          };
        }
        return {
          action: "hold",
          reason:
            "EDF: rollback-now — holding for manual rollback (auto-rollback disabled)",
        };
      }

      // review-now: notification only, ramp continues

      if (midRampStatus.status === "ship-now") {
        return { action: "advance" };
      }
    }
  }

  // 6. Min sample size gate
  const minSampleSize = step.holdConditions?.minSampleSize;
  if (minSampleSize && totalUsers < minSampleSize) {
    return {
      action: "hold",
      reason: `Waiting for minimum sample size (${totalUsers}/${minSampleSize})`,
    };
  }

  // 7. Approval gate (final)
  if (
    step.holdConditions?.requiresApproval &&
    schedule.stepApproval?.stepIndex !== schedule.currentStepIndex
  ) {
    return {
      action: "hold",
      reason: "Awaiting approval",
      awaitingApproval: true,
    };
  }

  return { action: "advance" };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build the startActions snapshot for an experiment ramp. The pre-ramp state
 * uses coverage=0 because the experiment isn't exposed to any traffic until
 * step 1 runs — mirroring the feature ramp model where startActions represent
 * the initial zero-traffic state. Targeting and weights are captured from the
 * last phase so rollback restores the correct configuration.
 */
export function buildExperimentStartActions(
  experiment: ExperimentInterface,
): RampScheduleInterface["startActions"] {
  const lastPhase = experiment.phases[experiment.phases.length - 1];
  if (!lastPhase) return [];

  return [
    {
      targetType: "experiment" as const,
      targetId: experiment.id,
      patch: {
        coverage: 0,
        variationWeights: lastPhase.variationWeights,
        condition: lastPhase.condition || "{}",
        savedGroups: lastPhase.savedGroups ?? [],
        prerequisites: lastPhase.prerequisites ?? [],
      },
    },
  ];
}
