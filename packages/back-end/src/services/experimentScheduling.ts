import { ExperimentInterface } from "shared/types/experiment";
import { DEFAULT_DECISION_FRAMEWORK_ENABLED } from "shared/constants";
import {
  ExperimentShippingCriteria,
  ScheduleStopAfter,
} from "shared/validators";
import { getValidDate, resolveScheduleStopAfter } from "shared/dates";
import {
  PRESET_DECISION_CRITERIA,
  getExperimentResultStatus,
  getHealthSettings,
  getPresetDecisionCriteriaForOrg,
  resolveScheduledShipDecision,
} from "shared/enterprise";
import { getSnapshotAnalysis } from "shared/util";
import { orgHasPremiumFeature } from "back-end/src/enterprise";
import { Context } from "back-end/src/models/BaseModel";
import { getLatestSuccessfulSnapshot } from "back-end/src/models/ExperimentSnapshotModel";
import { updateExperiment } from "back-end/src/models/ExperimentModel";
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

async function resolveDecisionCriteria(
  context: Context,
  experiment: ExperimentInterface,
) {
  const id =
    experiment.decisionFrameworkSettings?.decisionCriteriaId ??
    context.org.settings?.defaultDecisionCriteriaId;
  if (id) {
    const dc = await context.models.decisionCriteria.getById(id);
    if (dc) return dc;
  }
  return (
    getPresetDecisionCriteriaForOrg(context.org.settings) ??
    PRESET_DECISION_CRITERIA
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

  const map: Record<string, number> = {};
  experiment.variations.forEach((variation, i) => {
    const expected = dimension.variations[i]?.metrics?.[metricId]?.expected;
    if (typeof expected === "number") map[variation.id] = expected;
  });
  return Object.keys(map).length > 0 ? map : null;
}

export type ScheduledStopOutcome =
  | { kind: "shipped"; variationId: string; forced: boolean }
  | { kind: "stopped-no-ship" };

// Apply an experiment's scheduled end: stop it, and — per its shippingCriteria —
// either roll out a winning variation (auto-ship / force-ship) or just stop and
// leave the decision to a human ("notify"). Returns what happened so the caller
// can emit the appropriate lifecycle event.
export async function applyScheduledExperimentStop({
  context,
  experiment,
}: {
  context: Context;
  experiment: ExperimentInterface;
}): Promise<ScheduledStopOutcome> {
  const shipping = experiment.shippingCriteria;
  const canShip = canAutoShip(context);
  const autoShipEnabled = shipping?.mode === "auto-ship" && canShip;
  const forceShipEnabled = shipping?.mode === "force-ship" && canShip;

  let winnerVariationId: string | null = null;
  let forced = false;

  if (autoShipEnabled) {
    const healthSettings = getHealthSettings(context.org.settings, true);
    const decisionCriteria = await resolveDecisionCriteria(context, experiment);
    const resultStatus = getExperimentResultStatus({
      experimentData: experiment,
      healthSettings,
      decisionCriteria,
    });

    // Only load snapshot lift when there's actually an ambiguous tie to break.
    const isTie =
      resultStatus?.status === "ship-now" && resultStatus.variations.length > 1;
    const tiebreakerLiftByVariationId =
      isTie && shipping.tiebreakerMetricId
        ? await getTiebreakerLiftMap(
            context,
            experiment,
            shipping.tiebreakerMetricId,
          )
        : null;

    const decision = resolveScheduledShipDecision({
      resultStatus,
      tiebreakerLiftByVariationId,
    });
    if (decision.action === "ship") winnerVariationId = decision.variationId;
  }

  // Force-ship a pre-selected variation — either the top-level "force-ship"
  // mode, or auto-ship that found no clear winner and has a force-ship
  // fallback. Both read `fallbackVariationId`. Skip if the configured
  // variation no longer exists so we stop cleanly (notify) rather than
  // throwing and leaving the experiment running.
  const forceVariationId = forceShipEnabled
    ? shipping?.fallbackVariationId
    : autoShipEnabled && shipping?.fallback === "force-ship"
      ? shipping?.fallbackVariationId
      : undefined;
  if (
    !winnerVariationId &&
    forceVariationId &&
    experiment.variations.some((v) => v.id === forceVariationId)
  ) {
    winnerVariationId = forceVariationId;
    forced = true;
  }

  if (winnerVariationId) {
    await stopExperiment({
      context,
      input: {
        experimentId: experiment.id,
        results: "won",
        winnerVariationId,
        releasedVariationId: winnerVariationId,
        enableTemporaryRollout: true,
        reason: !forced
          ? "Scheduled end: auto-shipped the winning variation."
          : forceShipEnabled
            ? "Scheduled end: shipped the pre-selected variation."
            : "Scheduled end: no clear winner — force-shipped the configured variation.",
      },
    });
    return { kind: "shipped", variationId: winnerVariationId, forced };
  }

  // "notify" mode, or auto-ship with no winner and a notify fallback: stop the
  // experiment and leave the ship decision to a human.
  await stopExperiment({
    context,
    input: {
      experimentId: experiment.id,
      results: "inconclusive",
      reason: "Scheduled end reached.",
    },
  });
  logger.info(
    `Scheduled stop applied without auto-ship for experiment ${experiment.id}`,
  );
  return { kind: "stopped-no-ship" };
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

  let resolvedStopAt: Date | null = null;
  let deferredStopAfter: ScheduleStopAfter | null = null;

  if (stopAt) {
    resolvedStopAt = getValidDate(stopAt);
  } else if (stopAfter) {
    if (running) {
      const dateStarted =
        experiment.phases[experiment.phases.length - 1]?.dateStarted;
      resolvedStopAt = resolveScheduleStopAfter(
        dateStarted ? getValidDate(dateStarted) : new Date(),
        stopAfter,
      );
    } else {
      deferredStopAfter = stopAfter;
    }
  }

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

  const automated =
    criteria.mode === "auto-ship" || criteria.mode === "force-ship";
  if (automated && !canAutoShip(context)) {
    warnings.push(
      "Shipping automation requires the Decision Framework (Pro+ and enabled in org settings); the experiment will notify only until it's enabled.",
    );
  }
  // Automation only ever fires at a scheduled end — never on a manual stop —
  // so warn if there's no scheduled end for it to attach to.
  const hasScheduledEnd = !!(
    experiment.statusUpdateSchedule?.stopAt ||
    experiment.statusUpdateSchedule?.stopAfter
  );
  if (automated && !hasScheduledEnd) {
    warnings.push(
      "Shipping automation only runs at a scheduled end; set a stopAt or stopAfter (a manual stop won't ship automatically).",
    );
  }
  // A specific variation must be set + valid when force-shipping — either as
  // the top-level "force-ship" mode or as an auto-ship fallback.
  const requiresVariation =
    criteria.mode === "force-ship" ||
    (criteria.mode === "auto-ship" && criteria.fallback === "force-ship");
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
  if (
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
