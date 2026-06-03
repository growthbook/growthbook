/**
 * Experiment Ramp Schedule Service
 *
 * Handles ramp schedule operations specific to experiments: coverage changes,
 * rollback (new phase + rerandomization + bucket version increment), and end
 * strategy execution. These functions are called by the generic ramp schedule
 * machinery when it detects entityType === "experiment".
 */
import {
  ExperimentEndStrategy,
  ExperimentPatch,
  RampScheduleInterface,
} from "shared/validators";
import { ExperimentInterface, ExperimentPhase } from "shared/validators";
import {
  getMidRampDecisionStatus,
  getHealthSettings,
  getExperimentResultStatus,
  PRESET_DECISION_CRITERIA,
  PRESET_DECISION_CRITERIAS,
} from "shared/enterprise";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import { updateExperiment } from "back-end/src/models/ExperimentModel";
import { findSnapshotById } from "back-end/src/models/ExperimentSnapshotModel";
import { EvalDecision } from "back-end/src/services/rampScheduleEvaluator";
import { getSRMHealthData, getMultipleExposureHealthData } from "shared/health";
import {
  DEFAULT_SRM_MINIMINUM_COUNT_PER_VARIATION,
  DEFAULT_MULTIPLE_EXPOSURES_ENOUGH_DATA_THRESHOLD,
} from "shared/constants";
import { expandMetricGroups } from "shared/experiments";
import { DecisionCriteriaData } from "shared/enterprise";

// ---------------------------------------------------------------------------
// Decision criteria helper
// ---------------------------------------------------------------------------

async function resolveDecisionCriteria(
  ctx: ReqContext | ApiReqContext,
  experiment: ExperimentInterface,
): Promise<DecisionCriteriaData> {
  const id =
    experiment.decisionFrameworkSettings?.decisionCriteriaId ??
    ctx.org.settings?.defaultDecisionCriteriaId;

  if (!id) return PRESET_DECISION_CRITERIA;

  const preset = PRESET_DECISION_CRITERIAS.find((dc) => dc.id === id);
  if (preset) return preset;

  const stored = await ctx.models.decisionCriteria.getById(id);
  return stored ?? PRESET_DECISION_CRITERIA;
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

  if (patch.newPhase) {
    // Full phase change: end the current phase and start a new one.
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
    };
    phases.push(newPhase);
    return updateExperiment({
      context: ctx,
      experiment,
      changes: { phases },
    });
  }

  // Simple in-place update: patch coverage/weights in last phase.
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
  };
  phases[lastIdx] = updated;

  return updateExperiment({
    context: ctx,
    experiment,
    changes: { phases },
  });
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
  const preRampPatch = startAction?.targetType === "experiment"
    ? startAction.patch
    : null;

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
    ...(preRampPatch?.coverage !== null &&
    preRampPatch?.coverage !== undefined
      ? { coverage: preRampPatch.coverage }
      : {}),
    ...(preRampPatch?.variationWeights
      ? { variationWeights: preRampPatch.variationWeights }
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

/**
 * Execute an experiment end strategy when the ramp completes or a hard date
 * is reached. Drives the experiment to a terminal state based on the strategy type.
 */
export async function applyExperimentEndStrategy(
  ctx: ReqContext | ApiReqContext,
  experiment: ExperimentInterface,
  strategy: ExperimentEndStrategy,
): Promise<ExperimentInterface> {
  const now = new Date();

  switch (strategy.type) {
    case "soft":
      // No automatic action — surface as a CTA in the UI.
      return experiment;

    case "soft-edf": {
      // Evaluate EDF and auto-act only if there is a clear decision.
      const decisionCriteria = await resolveDecisionCriteria(ctx, experiment);
      const healthSettings = getHealthSettings(ctx.org.settings);
      const metricGroups = await ctx.models.metricGroups.getAll();
      const goalMetrics = expandMetricGroups(
        experiment.goalMetrics ?? [],
        metricGroups,
      );
      const guardrailMetrics = expandMetricGroups(
        experiment.guardrailMetrics ?? [],
        metricGroups,
      );

      const status = getExperimentResultStatus({
        experimentData: experiment,
        healthSettings,
        decisionCriteria,
      });

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
      if (status?.status === "rollback-now") {
        return updateExperiment({
          context: ctx,
          experiment,
          changes: {
            status: "stopped",
            results: "lost",
          },
        });
      }
      // Inconclusive — surface for manual review.
      return experiment;
    }

    case "hard-planned": {
      // Stop on the planned variation regardless of data.
      const isControl =
        strategy.plannedVariationId === "0" ||
        strategy.plannedVariationId === experiment.variations[0]?.id;
      return updateExperiment({
        context: ctx,
        experiment,
        changes: {
          status: "stopped",
          results: isControl ? "dnf" : "won",
          winner: isControl
            ? 0
            : experiment.variations.findIndex(
                (v) => v.id === strategy.plannedVariationId,
              ),
          releasedVariationId: strategy.plannedVariationId ?? "",
        },
      });
    }
  }
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
 *  4. Health signals (SRM, multiple exposures) per resolved rampBehavior
 *  5. EDF mid-ramp decision (super-stat-sig via getMidRampDecisionStatus)
 *  6. Minimum sample size
 *  7. Approval gate (final)
 *
 * Per-signal actions resolve with precedence:
 *  schedule.rampBehavior > EDF.rampBehavior > "warn"
 */
export async function evaluateExperimentRampStep(
  ctx: ReqContext | ApiReqContext,
  schedule: RampScheduleInterface,
  experiment: ExperimentInterface,
  now: Date,
): Promise<EvalDecision> {
  const step = schedule.steps[schedule.currentStepIndex];
  if (!step) return { action: "advance" };

  // Resolve per-signal ramp health actions with a 3-tier precedence:
  //   1. Per-experiment override on the schedule (`schedule.rampBehavior`)
  //   2. EDF defaults (`dc.rampBehavior`)
  //   3. "warn" (surface but don't auto-act)
  const dc = await resolveDecisionCriteria(ctx, experiment);
  const edfRb = dc.rampBehavior;
  const schedRb = schedule.rampBehavior;
  const srmAction = schedRb?.srmAction ?? edfRb?.srmAction ?? "warn";
  const noTrafficAction =
    schedRb?.noTrafficAction ?? edfRb?.noTrafficAction ?? "warn";
  const multipleExposureAction =
    schedRb?.multipleExposureAction ?? edfRb?.multipleExposureAction ?? "warn";

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
  if (!health.totalUsers) {
    const monitoringStartDate =
      schedule.monitoringStartDate ??
      schedule.currentStepEnteredAt ??
      schedule.startedAt;
    if (monitoringStartDate) {
      // Fixed 24h grace period before treating no-traffic as a health signal
      const gracePeriodMs = 24 * 60 * 60 * 1000;
      const elapsedMs = now.getTime() - monitoringStartDate.getTime();
      if (elapsedMs < gracePeriodMs) {
        const remainingMin = Math.ceil((gracePeriodMs - elapsedMs) / 60_000);
        return {
          action: "hold",
          reason: `No traffic yet — waiting for 24h grace period (~${remainingMin} min remaining)`,
          nextProcessAt: new Date(monitoringStartDate.getTime() + gracePeriodMs),
        };
      }
    }
    if (noTrafficAction === "rollback") {
      return {
        action: "rollback",
        reason: "No traffic detected — rolling back",
      };
    }
    if (noTrafficAction === "hold") {
      return {
        action: "hold",
        reason: "No traffic detected — holding step until traffic arrives",
      };
    }
  }

  // 3. SRM and multiple-exposure health checks
  {
    const healthSettings = getHealthSettings(ctx.org.settings);

    if (srmAction !== "warn") {
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
        if (srmAction === "rollback") {
          return {
            action: "rollback",
            reason: `SRM check failed (p=${health.srm?.toFixed(4) ?? "?"})`,
          };
        }
        return {
          action: "hold",
          reason: `SRM check failed — holding step (p=${health.srm?.toFixed(4) ?? "?"})`,
        };
      }
    }

    if (multipleExposureAction !== "warn") {
      const meData = getMultipleExposureHealthData({
        multipleExposuresCount: health.multipleExposures ?? 0,
        totalUsersCount: totalUsers,
        minCountThreshold: DEFAULT_MULTIPLE_EXPOSURES_ENOUGH_DATA_THRESHOLD,
        minPercentThreshold: healthSettings.multipleExposureMinPercent,
      });

      if (meData.status === "unhealthy") {
        if (multipleExposureAction === "rollback") {
          return {
            action: "rollback",
            reason: `Multiple exposures detected (${(meData.rawDecimal * 100).toFixed(1)}% of users)`,
          };
        }
        return {
          action: "hold",
          reason: `Multiple exposures detected — holding step (${(meData.rawDecimal * 100).toFixed(1)}% of users)`,
        };
      }
    }

    // NOTE: covariate imbalance is intentionally not gated here. If/when we
    // want to act on it, add `covariateImbalanceAction` to the EDF
    // `rampBehavior` alongside the other per-signal actions.
  }

  // 5. EDF mid-ramp gate — the EDF itself encodes the desired action via
  //    rollback-now / review-now / ship-now. No interpretation layer here.
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
        return {
          action: "rollback",
          reason: "EDF: rollback-now — auto-rolling back per decision criteria",
        };
      }

      if (midRampStatus.status === "review-now") {
        // review-now = hold and prompt the user; EDF rules encode urgency
        return {
          action: "hold",
          reason: "EDF: review-now — holding for user decision",
        };
      }

      if (midRampStatus.status === "ship-now") {
        // ship-now during a ramp: advance to the next step (or complete if last).
        // The UI surfaces a ship CTA independently.
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
 * Build the startActions snapshot for an experiment ramp. Captures the pre-ramp
 * phase state (coverage, variationWeights) so the rollback can restore them.
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
        coverage: lastPhase.coverage ?? 1,
        variationWeights: lastPhase.variationWeights,
      },
    },
  ];
}
