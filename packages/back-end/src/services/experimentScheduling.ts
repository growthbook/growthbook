import { ExperimentInterface } from "shared/types/experiment";
import { DEFAULT_DECISION_FRAMEWORK_ENABLED } from "shared/constants";
import {
  ExperimentType,
  ScheduledStopPlan,
  ScheduleStopAfter,
} from "shared/validators";
import { getValidDate, resolveScheduledStop } from "shared/dates";
import {
  buildTiebreakerLiftMap,
  getDecisionFrameworkStatus,
  getExperimentResultStatus,
  getHealthSettings,
  resolveScheduledShipDecision,
} from "shared/enterprise";
import { getSnapshotAnalysis } from "shared/util";
import { orgHasPremiumFeature } from "back-end/src/enterprise";
import { Context } from "back-end/src/models/BaseModel";
import { getLatestSuccessfulSnapshot } from "back-end/src/models/ExperimentSnapshotModel";
import { updateExperiment } from "back-end/src/models/ExperimentModel";
import {
  getExperimentMetricById,
  getExperimentDecisionCriteria,
} from "back-end/src/services/experiments";
import { BadRequestError } from "back-end/src/util/errors";
import { logger } from "back-end/src/util/logger";
import { stopExperiment } from "./experimentChanges/changeExperimentStatus";

// Auto-ship needs both the commercial feature and the org's decision-framework toggle.
function canAutoShip(context: Context): boolean {
  return (
    orgHasPremiumFeature(context.org, "decision-framework") &&
    (context.org.settings?.decisionFrameworkEnabled ??
      DEFAULT_DECISION_FRAMEWORK_ENABLED)
  );
}

// Used only to break an ambiguous multi-winner tie; null means "no winner".
async function getTiebreakerLiftMap(
  context: Context,
  experiment: ExperimentInterface,
  metricId: string,
): Promise<Record<string, number> | null> {
  const phase = experiment.phases.length - 1;
  if (phase < 0) return null;

  const snapshot = await getLatestSuccessfulSnapshot({
    context,
    experiment: experiment.id,
    phase,
  });
  if (!snapshot) return null;

  const analysis = getSnapshotAnalysis(snapshot);
  const dimension = analysis?.results?.[0];
  if (!dimension) return null;

  const metric = await getExperimentMetricById(context, metricId);

  // Key by the snapshot's own variation ids (index-aligned with the analysis
  // results); experiment.variations may have been reordered since.
  const snapshotVariationIds = snapshot.settings.variations.map((v) => v.id);

  return buildTiebreakerLiftMap({
    variations: dimension.variations,
    snapshotVariationIds,
    metricId,
    inverse: metric?.inverse,
  });
}

export type ScheduledStopOutcome =
  | { kind: "shipped"; variationId: string; forced: boolean }
  | { kind: "stopped" }
  | { kind: "kept-running"; recommendedVariationId: string | null };

// Recorded as analytical metadata, independent of what actually rolls out.
type ScheduledVerdict = {
  results: "won" | "lost" | "inconclusive";
  winnerIndex: number; // -1 when there's no winner
  winnerVariationId: string | null;
};

// Null when auto-ship isn't available, so callers can skip metadata tagging.
async function computeScheduledVerdict(
  context: Context,
  experiment: ExperimentInterface,
  tiebreakerMetricId: string | undefined,
): Promise<ScheduledVerdict | null> {
  if (!canAutoShip(context)) return null;

  const decisionCriteria = await getExperimentDecisionCriteria(
    context,
    experiment,
  );

  const inconclusive: ScheduledVerdict = {
    results: "inconclusive",
    winnerIndex: -1,
    winnerVariationId: null,
  };

  const resultsStatus = experiment.analysisSummary?.resultsStatus;
  if (!experiment.goalMetrics.length || !resultsStatus) return inconclusive;

  const overallStatus = getExperimentResultStatus({
    experimentData: experiment,
    healthSettings: getHealthSettings(context.org.settings, true),
    decisionCriteria,
  });
  if (
    overallStatus?.status === "unhealthy" &&
    (overallStatus.unhealthyData.srm ||
      overallStatus.unhealthyData.multipleExposures ||
      overallStatus.unhealthyData.covariateImbalance)
  ) {
    return inconclusive;
  }

  // The experiment is ending regardless, so evaluate on the results as they
  // stand, skipping the target-power (MDE) gate that applies mid-experiment.
  const resultStatus = getDecisionFrameworkStatus({
    resultsStatus,
    decisionCriteria,
    goalMetrics: experiment.goalMetrics,
    guardrailMetrics: experiment.guardrailMetrics,
    scheduledEndPassed: true,
  });
  if (!resultStatus) return inconclusive;

  if (resultStatus.status === "ship-now") {
    const isTie = resultStatus.variations.length > 1;
    const tiebreakerLiftByVariationId =
      isTie && tiebreakerMetricId
        ? await getTiebreakerLiftMap(context, experiment, tiebreakerMetricId)
        : null;
    const decision = resolveScheduledShipDecision({
      resultStatus,
      tiebreakerLiftByVariationId,
    });
    if (decision.action === "ship") {
      const winnerIndex = experiment.variations.findIndex(
        (v) => v.id === decision.variationId,
      );
      // A stale snapshot can reference a deleted variation (findIndex → -1);
      // reporting "won" without a valid index would make stopExperiment throw.
      if (winnerIndex >= 0) {
        return {
          results: "won",
          winnerIndex,
          winnerVariationId: decision.variationId,
        };
      }
    }
    return inconclusive;
  }

  // A clear rollback means the control "won" — tag it as a loss.
  if (resultStatus.status === "rollback-now") {
    const control = experiment.variations[0];
    return {
      results: "lost",
      winnerIndex: control ? 0 : -1,
      winnerVariationId: control?.id ?? null,
    };
  }

  return inconclusive;
}

const variationExists = (experiment: ExperimentInterface, id?: string) =>
  !!id && experiment.variations.some((v) => v.id === id);

// Returns the configured variation only if it still exists; a variation deleted
// after config-time validation yields null so callers keep the experiment running.
const resolveForceShipTarget = (
  experiment: ExperimentInterface,
  id?: string,
): string | null => {
  if (variationExists(experiment, id)) return id ?? null;
  if (id) {
    logger.warn(
      `Scheduled force-ship target ${id} no longer exists on experiment ${experiment.id}; keeping the experiment running. Update the scheduled-stop plan to select a valid variation, or stop the experiment manually.`,
    );
  }
  return null;
};

export async function applyScheduledExperimentStop({
  context,
  experiment,
}: {
  context: Context;
  experiment: ExperimentInterface;
}): Promise<ScheduledStopOutcome> {
  const plan = experiment.statusUpdateSchedule?.scheduledStopPlan;
  const mode = plan?.mode ?? "notify";
  const tiebreakerMetricId = plan?.tiebreakerMetricId;

  const nameFor = (id?: string | null) =>
    experiment.variations.find((v) => v.id === id)?.name ??
    "the selected variation";

  if (mode === "auto-ship" && canAutoShip(context)) {
    const verdict = await computeScheduledVerdict(
      context,
      experiment,
      tiebreakerMetricId,
    );
    if (verdict?.results === "won" && verdict.winnerVariationId) {
      await stopExperiment({
        context,
        input: {
          experimentId: experiment.id,
          results: "won",
          winnerVariationId: verdict.winnerVariationId,
          releasedVariationId: verdict.winnerVariationId,
          enableTemporaryRollout: true,
          reason: "Scheduled end: auto-shipped the winning variation.",
          analysis: `Automatically stopped at the scheduled end date. The winning variation **${nameFor(
            verdict.winnerVariationId,
          )}** was shipped as a temporary rollout.`,
        },
      });
      return {
        kind: "shipped",
        variationId: verdict.winnerVariationId,
        forced: false,
      };
    }

    const fallbackTarget =
      plan?.fallback === "force-ship"
        ? resolveForceShipTarget(experiment, plan.fallbackVariationId)
        : null;
    if (fallbackTarget) {
      await stopExperiment({
        context,
        input: {
          experimentId: experiment.id,
          results: verdict?.results ?? "inconclusive",
          winner: verdict?.winnerIndex,
          releasedVariationId: fallbackTarget,
          enableTemporaryRollout: true,
          reason:
            "Scheduled end: no clear winner — force-shipped the configured variation.",
          analysis: `Automatically stopped at the scheduled end date with no clear winner; the pre-selected fallback variation **${nameFor(
            fallbackTarget,
          )}** was shipped.`,
        },
      });
      return {
        kind: "shipped",
        variationId: fallbackTarget,
        forced: true,
      };
    }

    logger.info(
      `Scheduled end reached with no clear winner; keeping experiment ${experiment.id} running (notify).`,
    );
    return {
      kind: "kept-running",
      recommendedVariationId: verdict?.winnerVariationId ?? null,
    };
  }

  const forceShipTarget =
    mode === "force-ship"
      ? resolveForceShipTarget(experiment, plan?.fallbackVariationId)
      : null;
  if (forceShipTarget) {
    const verdict = await computeScheduledVerdict(
      context,
      experiment,
      tiebreakerMetricId,
    );
    await stopExperiment({
      context,
      input: {
        experimentId: experiment.id,
        // Record the verdict as metadata when available; without EDF stay
        // inconclusive but still release the configured variation.
        results: verdict?.results ?? "inconclusive",
        winner: verdict?.winnerIndex,
        releasedVariationId: forceShipTarget,
        enableTemporaryRollout: true,
        reason: "Scheduled end: shipped the pre-selected variation.",
        analysis: `Automatically stopped at the scheduled end date. The pre-selected variation **${nameFor(
          forceShipTarget,
        )}** was shipped.`,
      },
    });
    return { kind: "shipped", variationId: forceShipTarget, forced: true };
  }

  if (mode === "stop") {
    const verdict = await computeScheduledVerdict(
      context,
      experiment,
      tiebreakerMetricId,
    );
    await stopExperiment({
      context,
      input: {
        experimentId: experiment.id,
        results: verdict?.results ?? "inconclusive",
        winner: verdict?.winnerIndex ?? -1,
        enableTemporaryRollout: false,
        reason: "Scheduled end reached.",
        analysis:
          "Automatically stopped at the scheduled end date. No variation was shipped.",
      },
    });
    return { kind: "stopped" };
  }

  const verdict = await computeScheduledVerdict(
    context,
    experiment,
    tiebreakerMetricId,
  );
  logger.info(
    `Scheduled end reached; keeping experiment ${experiment.id} running (notify).`,
  );
  return {
    kind: "kept-running",
    recommendedVariationId: verdict?.winnerVariationId ?? null,
  };
}

// Raw schedule fields as they arrive from any write path; dates may be strings
// (API/controller payloads) or Dates (full-replace).
export type ScheduleUpdateInput = {
  startAt?: string | Date | null;
  stopAt?: string | Date | null;
  stopAfter?: ScheduleStopAfter | null;
  scheduledStopPlan?: ScheduledStopPlan | null;
};

// Shared schedule validation for every write path. Throws BadRequestError on
// hard errors; returns soft warnings from the stop-plan check. `existingSchedule`
// is the stored schedule (null on create) and drives the "changed" guards;
// `variations`/`goalMetrics` are the effective (post-update) values.
export function validateScheduleUpdate({
  context,
  experimentType,
  status,
  archived,
  phaseStart,
  existingSchedule,
  variations,
  goalMetrics,
  incoming,
}: {
  context: Context;
  experimentType: ExperimentType;
  status: ExperimentInterface["status"];
  archived: boolean;
  phaseStart?: Date | string | null;
  existingSchedule?: {
    startAt?: Date | string | null;
    stopAt?: Date | string | null;
  } | null;
  variations: ExperimentInterface["variations"];
  goalMetrics: string[];
  incoming: ScheduleUpdateInput;
}): string[] {
  if (experimentType === "multi-armed-bandit") {
    throw new BadRequestError(
      "Scheduling is not supported for Bandit experiments.",
    );
  }
  if (archived || status === "stopped") {
    throw new BadRequestError(
      "Cannot change the schedule of a stopped or archived experiment.",
    );
  }

  const now = new Date();
  const running = status === "running";

  // A start can only be (re)scheduled into the future, but skip the check when
  // it's unchanged so end/plan edits don't trip on a now-past start.
  const startAtDate = incoming.startAt ? getValidDate(incoming.startAt) : null;
  if (startAtDate) {
    const existingStartAt = existingSchedule?.startAt ?? null;
    const startAtChanged =
      !existingStartAt ||
      getValidDate(existingStartAt).getTime() !== startAtDate.getTime();
    if (startAtChanged && startAtDate <= now) {
      throw new BadRequestError("startAt must be in the future.");
    }
  }

  // Resolve a relative stopAfter now for a running experiment; defer it for a draft.
  const { stopAt: resolvedStopAt, stopAfter: deferredStopAfter } =
    resolveScheduledStop({
      stopAt: incoming.stopAt,
      stopAfter: incoming.stopAfter,
      base: phaseStart ? getValidDate(phaseStart) : now,
      active: running,
      now,
    });

  if (resolvedStopAt && startAtDate && resolvedStopAt <= startAtDate) {
    throw new BadRequestError("stopAt must be after startAt.");
  }

  // A past stop is never staged. An absolute stopAt is rejected only when newly
  // set or changed, so unrelated edits that resubmit a passed end don't trip; a
  // relative stopAfter resolving into the past is always rejected.
  if (resolvedStopAt && resolvedStopAt <= now) {
    const existingStopAt = existingSchedule?.stopAt ?? null;
    const stopAtUnchanged =
      !!incoming.stopAt &&
      !!existingStopAt &&
      getValidDate(existingStopAt).getTime() === resolvedStopAt.getTime();
    if (!stopAtUnchanged) {
      throw new BadRequestError(
        incoming.stopAt
          ? "stopAt must be in the future. Choose a future end date, or stop the experiment manually."
          : `stopAfter of ${incoming.stopAfter?.value} ${incoming.stopAfter?.unit} resolves to ${resolvedStopAt.toISOString()}, which has already passed. Choose a longer duration or a future stopAt, or stop the experiment manually.`,
      );
    }
  }

  // Validate the plan against the end this request is setting, not the stored one.
  const warnings: string[] = [];
  if (incoming.scheduledStopPlan) {
    const hasScheduledEnd = !!(resolvedStopAt || deferredStopAfter);
    warnings.push(
      ...validateScheduledStopPlan(
        context,
        { variations, goalMetrics },
        incoming.scheduledStopPlan,
        hasScheduledEnd,
      ),
    );
  }
  return warnings;
}

// Validate the scheduled-stop plan against the experiment and the end this update
// is setting. Throws on hard config errors; returns soft warnings.
function validateScheduledStopPlan(
  context: Context,
  experiment: Pick<ExperimentInterface, "variations" | "goalMetrics">,
  plan: ScheduledStopPlan,
  hasScheduledEnd: boolean,
): string[] {
  const warnings: string[] = [];
  const mode = plan.mode;
  const hasEDF = canAutoShip(context);

  // Auto-ship needs the decision framework to pick a winner.
  if (mode === "auto-ship" && !hasEDF) {
    throw new BadRequestError(
      "Auto-ship requires the Decision Framework (Pro+ and enabled in org settings)",
    );
  }
  // Auto-ship requires a fallback to specify what to do when there's no winner.
  if (mode === "auto-ship" && !plan.fallback) {
    throw new BadRequestError('fallback is required when mode is "auto-ship".');
  }
  // force-ship/stop work without EDF, but no win/loss verdict is recorded.
  if ((mode === "force-ship" || mode === "stop") && !hasEDF) {
    warnings.push(
      `The Decision Framework isn't available, so no win/loss verdict will be recorded; the experiment will still ${
        mode === "force-ship"
          ? "roll out the selected variation"
          : "stop with no rollout"
      } at the end date.`,
    );
  }
  // Every mode except "notify" only acts at a scheduled end.
  if (mode !== "notify" && !hasScheduledEnd) {
    throw new BadRequestError(
      `You must set a scheduled end date (stopAt or stopAfter) to use ${mode}.`,
    );
  }
  // A valid variation must be set when force-shipping (top-level or auto-ship fallback).
  const requiresVariation =
    mode === "force-ship" ||
    (mode === "auto-ship" && plan.fallback === "force-ship");
  if (requiresVariation) {
    if (!plan.fallbackVariationId) {
      throw new BadRequestError(
        "fallbackVariationId is required when force-shipping a variation.",
      );
    }
    if (!experiment.variations.some((v) => v.id === plan.fallbackVariationId)) {
      throw new BadRequestError(
        "fallbackVariationId must match an experiment variation.",
      );
    }
  }
  // The tiebreaker feeds the EDF verdict for auto-ship, force-ship, and stop.
  if (
    mode !== "notify" &&
    plan.tiebreakerMetricId &&
    !(experiment.goalMetrics ?? []).includes(plan.tiebreakerMetricId)
  ) {
    throw new BadRequestError("tiebreakerMetricId must be a goal metric.");
  }
  return warnings;
}

// Full-replace of an experiment's schedule and scheduled-stop plan in a single
// write; the arguments are the complete desired state, so anything left
// undefined/null is cleared. Hard config errors throw; soft issues are warnings.
export async function setExperimentSchedule({
  context,
  experiment,
  startAt,
  stopAt,
  stopAfter,
  scheduledStopPlan,
}: {
  context: Context;
  experiment: ExperimentInterface;
  startAt?: string | Date | null;
  stopAt?: string | Date | null;
  stopAfter?: ScheduleStopAfter | null;
  scheduledStopPlan?: ScheduledStopPlan | null;
}): Promise<{ experiment: ExperimentInterface; warnings: string[] }> {
  const running = experiment.status === "running";
  const dateStarted =
    experiment.phases[experiment.phases.length - 1]?.dateStarted;

  const warnings = validateScheduleUpdate({
    context,
    experimentType: experiment.type ?? "standard",
    status: experiment.status,
    archived: !!experiment.archived,
    phaseStart: dateStarted,
    existingSchedule: experiment.statusUpdateSchedule,
    variations: experiment.variations,
    goalMetrics: experiment.goalMetrics,
    incoming: { startAt, stopAt, stopAfter, scheduledStopPlan },
  });

  const startAtDate = startAt ? getValidDate(startAt) : null;
  const {
    stopAt: resolvedStopAt,
    stopAfter: deferredStopAfter,
    stagedStop,
  } = resolveScheduledStop({
    stopAt,
    stopAfter,
    base: dateStarted ? getValidDate(dateStarted) : new Date(),
    active: running,
  });

  const hasScheduledEnd = !!(resolvedStopAt || deferredStopAfter);

  const scheduleDates = {
    ...(startAtDate ? { startAt: startAtDate } : {}),
    ...(resolvedStopAt ? { stopAt: resolvedStopAt } : {}),
    ...(deferredStopAfter ? { stopAfter: deferredStopAfter } : {}),
  };
  // The stop plan is persisted only when there's a scheduled end for it to fire
  // at; a plan on a start-only schedule is inert, so it's dropped.
  const schedule =
    Object.keys(scheduleDates).length > 0
      ? {
          ...scheduleDates,
          ...(hasScheduledEnd && scheduledStopPlan
            ? { scheduledStopPlan }
            : {}),
        }
      : null;

  const changes: Partial<ExperimentInterface> = {
    statusUpdateSchedule: schedule,
    // Running experiments stage the stop now; drafts stage nothing here. Either
    // way any previously-staged action is reset to match the new schedule.
    nextScheduledStatusUpdate: stagedStop,
  };

  const updated = await updateExperiment({ context, experiment, changes });
  return { experiment: updated, warnings };
}
