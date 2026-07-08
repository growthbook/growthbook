import { ExperimentInterface } from "shared/types/experiment";
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
import { logger } from "back-end/src/util/logger";
import { stopExperiment } from "./experimentChanges/changeExperimentStatus";

// Auto-ship is a Pro+ feature and rides on the decision framework — the winner
// is whatever the org's decision criteria consider a clear ship.
function canAutoShip(context: Context): boolean {
  return orgHasPremiumFeature(context.org, "decision-framework");
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

  let winnerVariationId: string | null = null;
  let forced = false;

  if (shipping?.mode === "auto-ship" && canAutoShip(context)) {
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

  // No clear winner but the user opted to force-ship a specific variation.
  if (
    !winnerVariationId &&
    shipping?.mode === "auto-ship" &&
    shipping.fallback === "force-ship" &&
    shipping.fallbackVariationId
  ) {
    winnerVariationId = shipping.fallbackVariationId;
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
        reason: forced
          ? "Scheduled end: no clear winner — force-shipped the configured variation."
          : "Scheduled end: auto-shipped the winning variation.",
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
