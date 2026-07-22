import { ExperimentInterface } from "shared/types/experiment";
import { DEFAULT_DECISION_FRAMEWORK_ENABLED } from "shared/constants";
import { ScheduledStopPlan, ScheduleStopAfter } from "shared/validators";
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

// Mirrors the UI gate: auto-ship needs both the commercial feature and the
// org's decision-framework toggle enabled.
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

  // Key by the SNAPSHOT's own variation ids, which are index-aligned with the
  // analysis results. The current experiment.variations order may have been
  // reordered/edited since this snapshot, so keying by it would misattribute
  // lift to the wrong variation.
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

  // The experiment is ending regardless, so evaluate the decision criteria on
  // the results as they stand, skipping the target-power (MDE) gate that
  // would apply mid-experiment.
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
      // A stale snapshot can reference a variation id that no longer exists on
      // the experiment (findIndex → -1). Never report "won" without a valid
      // index — that would make stopExperiment throw. Degrade to inconclusive.
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

// Falls back to control if the configured variation no longer exists, so a
// hard cutoff still ships something rather than degrading to keep-running.
const resolveForceShipTarget = (
  experiment: ExperimentInterface,
  id?: string,
): string | null =>
  variationExists(experiment, id)
    ? (id as string)
    : (experiment.variations[0]?.id ?? null);

export async function applyScheduledExperimentStop({
  context,
  experiment,
}: {
  context: Context;
  experiment: ExperimentInterface;
}): Promise<ScheduledStopOutcome> {
  const plan = experiment.scheduledStopPlan;
  const mode = plan?.mode ?? "notify";
  const tiebreakerMetricId = plan?.tiebreakerMetricId;

  // Rendered as Markdown in the "Results Summary" banners (StoppedExperimentBanner,
  // legacy StatusBanner, CompletedExperimentList), unlike the phase-level `reason`.
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
        // With a verdict, record it as metadata; without EDF, treat the forced
        // variation as the declared winner.
        results: verdict?.results ?? "won",
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

function assertSchedulable(experiment: ExperimentInterface) {
  if (experiment.type === "multi-armed-bandit") {
    throw new BadRequestError(
      "Scheduling is not supported for Bandit experiments.",
    );
  }
  if (experiment.archived || experiment.status === "stopped") {
    throw new BadRequestError(
      "Cannot change the schedule of a stopped or archived experiment.",
    );
  }
}

// Validate the scheduled-stop plan against the experiment and the scheduled end
// this update is setting. Throws on hard config errors; returns soft warnings
// (feature not enabled, no scheduled end, tiebreaker not a goal metric).
// Exported so the create/update experiment body paths run the same checks as
// the dedicated PUT /schedule endpoint and can't diverge.
export function validateScheduledStopPlan(
  context: Context,
  experiment: ExperimentInterface,
  plan: ScheduledStopPlan,
  hasScheduledEnd: boolean,
): string[] {
  const warnings: string[] = [];
  const mode = plan.mode;
  const hasEDF = canAutoShip(context);

  // Auto-ship needs the decision framework to pick a winner; without it, the
  // end date degrades to the soft "keep running + notify" behavior.
  if (mode === "auto-ship" && !hasEDF) {
    warnings.push(
      "Auto-ship requires the Decision Framework (Pro+ and enabled in org settings); until it's enabled, the experiment will keep running and just notify at the end date.",
    );
  }
  // force-ship/stop work without the decision framework, but the analytical
  // verdict (won/lost/inconclusive) is only recorded when it's available.
  if ((mode === "force-ship" || mode === "stop") && !hasEDF) {
    warnings.push(
      `The Decision Framework isn't available, so no win/loss verdict will be recorded; the experiment will still ${
        mode === "force-ship"
          ? "roll out the selected variation"
          : "stop with no rollout"
      } at the end date.`,
    );
  }
  // Every mode except the soft default only acts at a scheduled end — never on
  // a manual stop — so warn if there's no scheduled end for it to attach to.
  if (mode !== "notify" && !hasScheduledEnd) {
    warnings.push(
      "This only runs at a scheduled end; set a stopAt or stopAfter (a manual stop won't trigger it).",
    );
  }
  // A specific variation must be set + valid when force-shipping — either as
  // the top-level "force-ship" mode or as an auto-ship fallback.
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
    warnings.push(
      "tiebreakerMetricId is not one of the experiment's goal metrics; it will be ignored.",
    );
  }
  return warnings;
}

// Full-replace of an experiment's schedule (start + end) and scheduled-stop plan
// in a single write. The arguments represent the COMPLETE desired state: any
// value left undefined/null is cleared. A relative `stopAfter` is resolved now
// for a running experiment and deferred for a draft (resolved at start by
// executeExperimentStart). Hard config errors throw; soft issues are warnings.
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
  assertSchedulable(experiment);
  const warnings: string[] = [];
  const running = experiment.status === "running";

  const startAtDate = startAt ? getValidDate(startAt) : null;

  // A start can only be (re)scheduled into the future. Skip the check when the
  // start is unchanged so end/plan edits on an already-scheduled experiment
  // don't trip on a start that's now in the past.
  if (startAtDate) {
    const existingStartAt = experiment.statusUpdateSchedule?.startAt;
    const startAtChanged =
      !existingStartAt ||
      getValidDate(existingStartAt).getTime() !== startAtDate.getTime();
    if (startAtChanged && startAtDate <= new Date()) {
      throw new BadRequestError("startAt must be in the future.");
    }
  }

  const dateStarted =
    experiment.phases[experiment.phases.length - 1]?.dateStarted;
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

  if (resolvedStopAt && startAtDate && resolvedStopAt <= startAtDate) {
    throw new BadRequestError("stopAt must be after startAt.");
  }
  if (resolvedStopAt && resolvedStopAt <= new Date()) {
    warnings.push(
      "The resolved stop time is in the past; the experiment will stop on the next scheduler run.",
    );
  }

  // Validate the plan against the end we're setting in THIS request, not the
  // stale stored one.
  const hasScheduledEnd = !!(resolvedStopAt || deferredStopAfter);
  if (scheduledStopPlan) {
    warnings.push(
      ...validateScheduledStopPlan(
        context,
        experiment,
        scheduledStopPlan,
        hasScheduledEnd,
      ),
    );
  }

  const schedule = {
    ...(startAtDate ? { startAt: startAtDate } : {}),
    ...(resolvedStopAt ? { stopAt: resolvedStopAt } : {}),
    ...(deferredStopAfter ? { stopAfter: deferredStopAfter } : {}),
  };

  const changes: Partial<ExperimentInterface> = {
    statusUpdateSchedule: Object.keys(schedule).length > 0 ? schedule : null,
    // Running experiments stage the stop immediately; drafts stage nothing here
    // (a scheduled start is staged later via the start endpoint). Either way any
    // previously-staged action is reset so it must be re-staged from the new
    // schedule.
    nextScheduledStatusUpdate: stagedStop,
    scheduledStopPlan: scheduledStopPlan ?? null,
  };

  const updated = await updateExperiment({ context, experiment, changes });
  return { experiment: updated, warnings };
}
