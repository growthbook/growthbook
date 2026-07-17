import { ExperimentInterface } from "shared/types/experiment";
import { DEFAULT_DECISION_FRAMEWORK_ENABLED } from "shared/constants";
import {
  ExperimentShippingCriteria,
  ScheduleStopAfter,
} from "shared/validators";
import { getValidDate, resolveScheduledStop } from "shared/dates";
import {
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

// Auto-ship is a Pro+ feature and rides on the decision framework — the winner
// is whatever the org's decision criteria consider a clear ship. Requires both
// the commercial feature and the org's decision-framework toggle (mirrors the
// UI gate and getExperimentResultStatus's internal check).
function canAutoShip(context: Context): boolean {
  return (
    orgHasPremiumFeature(context.org, "decision-framework") &&
    (context.org.settings?.decisionFrameworkEnabled ??
      DEFAULT_DECISION_FRAMEWORK_ENABLED)
  );
}

// Relative lift of `metricId` per variation id, from the latest successful
// snapshot's default analysis. Used only to break an ambiguous multi-winner
// tie. Returns null when the data isn't available (→ treated as no winner).
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

  // For a lower-is-better (inverse) metric, flip the sign so that "highest
  // lift" in resolveScheduledShipDecision selects the best variation, not the
  // worst. `expected` is the raw relative lift and is not direction-adjusted.
  const metric = await getExperimentMetricById(context, metricId);
  const sign = metric?.inverse ? -1 : 1;

  // Key by the SNAPSHOT's own variation ids, which are index-aligned with the
  // analysis results. The current experiment.variations order may have been
  // reordered/edited since this snapshot, so keying by it would misattribute
  // lift to the wrong variation.
  const snapshotVariationIds = snapshot.settings.variations.map((v) => v.id);

  const map: Record<string, number> = {};
  dimension.variations.forEach((dv, i) => {
    const id = snapshotVariationIds[i];
    const expected = dv?.metrics?.[metricId]?.expected;
    if (id && typeof expected === "number") map[id] = expected * sign;
  });
  return Object.keys(map).length > 0 ? map : null;
}

export type ScheduledStopOutcome =
  // Stopped and rolled out a variation (auto-ship winner, or a forced variation).
  | { kind: "shipped"; variationId: string; forced: boolean }
  // Stopped with no rollout (mode "stop" / hard deadline).
  | { kind: "stopped" }
  // Soft end: the experiment was left running and only notified.
  | { kind: "kept-running"; recommendedVariationId: string | null };

// The EDF + tiebreaker verdict, recorded as analytical metadata independent of
// what actually rolls out. Null when the decision framework isn't available.
type ScheduledVerdict = {
  results: "won" | "lost" | "inconclusive";
  winnerIndex: number; // -1 when there's no winner
  winnerVariationId: string | null;
};

// Run the decision framework (+ tiebreaker) and translate it into a
// won/lost/inconclusive verdict. Gated on the decision framework (Pro); returns
// null when unavailable so callers can skip metadata tagging.
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
  // the results as they stand — pass daysNeeded: 0 to skip the target-power
  // (MDE) gate that getExperimentResultStatus would apply mid-experiment.
  const resultStatus = getDecisionFrameworkStatus({
    resultsStatus,
    decisionCriteria,
    goalMetrics: experiment.goalMetrics,
    guardrailMetrics: experiment.guardrailMetrics,
    daysNeeded: 0,
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

// The variation to force-ship: the configured one, or control (the first
// variation) if it no longer exists, so a "hard cutoff" still ships something
// rather than silently degrading to keep-running. Null only if the experiment
// has no variations at all (shouldn't happen).
const resolveForceShipTarget = (
  experiment: ExperimentInterface,
  id?: string,
): string | null =>
  variationExists(experiment, id)
    ? (id as string)
    : (experiment.variations[0]?.id ?? null);

// Apply an experiment's scheduled end per its shippingCriteria. Rollout and the
// analytical verdict are decoupled: "auto-ship" ships the EDF winner; "force-
// ship" rolls out a chosen variation; "stop" is a hard stop with no rollout;
// "notify" is soft — the experiment keeps running and is only flagged. For
// force-ship/stop the EDF verdict (when available) is recorded as metadata but
// never changes what's shipped.
export async function applyScheduledExperimentStop({
  context,
  experiment,
}: {
  context: Context;
  experiment: ExperimentInterface;
}): Promise<ScheduledStopOutcome> {
  const shipping = experiment.shippingCriteria;
  const mode = shipping?.mode ?? "notify";
  const tiebreakerMetricId = shipping?.tiebreakerMetricId;

  // ── Auto-ship: ship the EDF winner; otherwise fall back. ──
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
        },
      });
      return {
        kind: "shipped",
        variationId: verdict.winnerVariationId,
        forced: false,
      };
    }

    // No clear winner → force-ship fallback (stop + rollout) or notify (soft).
    const fallbackTarget =
      shipping?.fallback === "force-ship"
        ? resolveForceShipTarget(experiment, shipping.fallbackVariationId)
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

  // ── Force-ship a specific variation (basic; EDF verdict is bonus metadata). ──
  const forceShipTarget =
    mode === "force-ship"
      ? resolveForceShipTarget(experiment, shipping?.fallbackVariationId)
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
      },
    });
    return { kind: "shipped", variationId: forceShipTarget, forced: true };
  }

  // ── Stop: hard deadline, no rollout (EDF verdict is bonus metadata). ──
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
      },
    });
    return { kind: "stopped" };
  }

  // ── Notify (default): soft — keep the experiment running. ──
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

// ─── Scheduled-stop config (REST + generic update service layer) ─────────────

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

// Set the experiment's scheduled end. Absolute `stopAt` is stored directly; a
// relative `stopAfter` is resolved now for a running experiment (off its actual
// start) or deferred for a draft (resolved at start by executeExperimentStart).
export async function setExperimentScheduledStop({
  context,
  experiment,
  stopAt,
  stopAfter,
}: {
  context: Context;
  experiment: ExperimentInterface;
  stopAt?: string | Date | null;
  stopAfter?: ScheduleStopAfter | null;
}): Promise<{ experiment: ExperimentInterface; warnings: string[] }> {
  assertSchedulable(experiment);
  const warnings: string[] = [];
  const running = experiment.status === "running";

  const dateStarted =
    experiment.phases[experiment.phases.length - 1]?.dateStarted;
  const { stopAt: resolvedStopAt, stopAfter: deferredStopAfter } =
    resolveScheduledStop({
      stopAt,
      stopAfter,
      base: dateStarted ? getValidDate(dateStarted) : new Date(),
      active: running,
    });

  if (resolvedStopAt && resolvedStopAt <= new Date()) {
    warnings.push(
      "The resolved stop time is in the past; the experiment will stop on the next scheduler run.",
    );
  }

  const startAt = experiment.statusUpdateSchedule?.startAt;
  const changes: Partial<ExperimentInterface> = {
    statusUpdateSchedule: {
      ...(startAt ? { startAt } : {}),
      ...(resolvedStopAt ? { stopAt: resolvedStopAt } : {}),
      ...(deferredStopAfter ? { stopAfter: deferredStopAfter } : {}),
    },
  };
  // Only a running experiment stages the stop now; a draft stages it at start.
  if (running) {
    changes.nextScheduledStatusUpdate = resolvedStopAt
      ? { type: "stop", date: resolvedStopAt }
      : null;
  }

  const updated = await updateExperiment({ context, experiment, changes });
  return { experiment: updated, warnings };
}

// Clear the scheduled end, preserving any scheduled start.
export async function clearExperimentScheduledStop({
  context,
  experiment,
}: {
  context: Context;
  experiment: ExperimentInterface;
}): Promise<{ experiment: ExperimentInterface }> {
  const startAt = experiment.statusUpdateSchedule?.startAt;
  const changes: Partial<ExperimentInterface> = {
    statusUpdateSchedule: startAt ? { startAt } : null,
    ...(experiment.nextScheduledStatusUpdate?.type === "stop"
      ? { nextScheduledStatusUpdate: null }
      : {}),
  };
  const updated = await updateExperiment({ context, experiment, changes });
  return { experiment: updated };
}

// Validate + persist the shipping automation. Surfaces soft issues (feature not
// enabled, tiebreaker not a goal metric) as warnings; hard config errors throw.
export async function setExperimentShippingCriteria({
  context,
  experiment,
  criteria,
}: {
  context: Context;
  experiment: ExperimentInterface;
  criteria: ExperimentShippingCriteria;
}): Promise<{ experiment: ExperimentInterface; warnings: string[] }> {
  if (experiment.type === "multi-armed-bandit") {
    throw new BadRequestError(
      "Shipping automation is not supported for Bandit experiments.",
    );
  }
  const warnings: string[] = [];
  const mode = criteria.mode;
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
  const hasScheduledEnd = !!(
    experiment.statusUpdateSchedule?.stopAt ||
    experiment.statusUpdateSchedule?.stopAfter
  );
  if (mode !== "notify" && !hasScheduledEnd) {
    warnings.push(
      "This only runs at a scheduled end; set a stopAt or stopAfter (a manual stop won't trigger it).",
    );
  }
  // A specific variation must be set + valid when force-shipping — either as
  // the top-level "force-ship" mode or as an auto-ship fallback.
  const requiresVariation =
    mode === "force-ship" ||
    (mode === "auto-ship" && criteria.fallback === "force-ship");
  if (requiresVariation) {
    if (!criteria.fallbackVariationId) {
      throw new BadRequestError(
        "fallbackVariationId is required when force-shipping a variation.",
      );
    }
    if (
      !experiment.variations.some((v) => v.id === criteria.fallbackVariationId)
    ) {
      throw new BadRequestError(
        "fallbackVariationId must match an experiment variation.",
      );
    }
  }
  // The tiebreaker feeds the EDF verdict for auto-ship, force-ship, and stop.
  if (
    mode !== "notify" &&
    criteria.tiebreakerMetricId &&
    !(experiment.goalMetrics ?? []).includes(criteria.tiebreakerMetricId)
  ) {
    warnings.push(
      "tiebreakerMetricId is not one of the experiment's goal metrics; it will be ignored.",
    );
  }

  const updated = await updateExperiment({
    context,
    experiment,
    changes: { shippingCriteria: criteria },
  });
  return { experiment: updated, warnings };
}

export async function clearExperimentShippingCriteria({
  context,
  experiment,
}: {
  context: Context;
  experiment: ExperimentInterface;
}): Promise<{ experiment: ExperimentInterface }> {
  const updated = await updateExperiment({
    context,
    experiment,
    changes: { shippingCriteria: null },
  });
  return { experiment: updated };
}
