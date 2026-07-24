import { addDays, differenceInHours, differenceInMinutes } from "date-fns";
import { getLatestPhaseVariations } from "shared/experiments";
import {
  DecisionCriteriaAction,
  DecisionCriteriaData,
  DecisionCriteriaRule,
  DecisionFrameworkExperimentRecommendationStatus,
  DecisionFrameworkVariation,
  ExperimentAnalysisSummaryResultsStatus,
  ExperimentAnalysisSummaryVariationStatus,
  ExperimentDataForStatus,
  ExperimentDataForStatusStringDates,
  ExperimentHealthSettings,
  ExperimentResultStatusData,
  ExperimentUnhealthyData,
} from "shared/types/experiment";
import {
  SafeRolloutInterface,
  SafeRolloutSnapshotInterface,
} from "shared/types/safe-rollout";
import { SnapshotVariation } from "shared/types/experiment-snapshot";
import { OrganizationSettings } from "shared/types/organization";
import {
  DEFAULT_DECISION_FRAMEWORK_ENABLED,
  DEFAULT_EXPERIMENT_MIN_LENGTH_DAYS,
  DEFAULT_MULTIPLE_EXPOSURES_ENOUGH_DATA_THRESHOLD,
  DEFAULT_MULTIPLE_EXPOSURES_THRESHOLD,
  DEFAULT_SRM_BANDIT_MINIMINUM_COUNT_PER_VARIATION,
  DEFAULT_SRM_MINIMINUM_COUNT_PER_VARIATION,
  DEFAULT_SRM_THRESHOLD,
} from "../../constants";
import { daysBetween, getValidDate } from "../../dates";
import { getMultipleExposureHealthData, getSRMHealthData } from "../../health";
import {
  PRESET_DECISION_CRITERIA,
  PRESET_DECISION_CRITERIAS,
} from "./constants";

// Evaluate a single rule on a variation result
// Returns the action if the rule is met, otherwise undefined
export function evaluateDecisionRuleOnVariation({
  rule,
  variationStatus,
  goalMetrics,
  guardrailMetrics,
  requireSuperStatSig,
}: {
  rule: DecisionCriteriaRule;
  variationStatus: ExperimentAnalysisSummaryVariationStatus;
  goalMetrics: string[];
  guardrailMetrics: string[];
  requireSuperStatSig: boolean;
}): DecisionCriteriaAction | undefined {
  const { conditions, action } = rule;

  const allConditionsMet = conditions.every((condition) => {
    const desiredStatus =
      condition.direction === "statsigWinner"
        ? "won"
        : condition.direction === "statsigLoser"
          ? "lost"
          : "neutral";
    if (condition.metrics === "goals") {
      const metrics = goalMetrics;
      const metricResults = variationStatus.goalMetrics;

      const fieldToCheck = requireSuperStatSig
        ? "superStatSigStatus"
        : "status";

      if (condition.match === "all") {
        return metrics.every(
          (m) => metricResults?.[m]?.[fieldToCheck] === desiredStatus,
        );
      } else if (condition.match === "any") {
        return metrics.some(
          (m) => metricResults?.[m]?.[fieldToCheck] === desiredStatus,
        );
      } else if (condition.match === "none") {
        return metrics.every(
          (m) => metricResults?.[m]?.[fieldToCheck] !== desiredStatus,
        );
      }
    } else if (condition.metrics === "guardrails") {
      const metrics = guardrailMetrics;
      const metricResults = variationStatus.guardrailMetrics;

      if (condition.match === "all") {
        return metrics.every(
          (m) => metricResults?.[m]?.status === desiredStatus,
        );
      } else if (condition.match === "any") {
        return metrics.some(
          (m) => metricResults?.[m]?.status === desiredStatus,
        );
      } else if (condition.match === "none") {
        return metrics.every(
          (m) => metricResults?.[m]?.status !== desiredStatus,
        );
      }
    }
  });

  if (allConditionsMet) {
    return action;
  }

  return undefined;
}

// Get the decision for each variation based on the decision criteria
export function getVariationDecisions({
  resultsStatus,
  decisionCriteria,
  powerReached,
  goalMetrics,
  guardrailMetrics,
}: {
  resultsStatus: ExperimentAnalysisSummaryResultsStatus;
  decisionCriteria: DecisionCriteriaData;
  powerReached: boolean;
  goalMetrics: string[];
  guardrailMetrics: string[];
}): {
  variation: DecisionFrameworkVariation;
  decisionCriteriaAction: DecisionCriteriaAction | null;
}[] {
  const results: {
    variation: DecisionFrameworkVariation;
    decisionCriteriaAction: DecisionCriteriaAction | null;
  }[] = [];

  const { rules } = decisionCriteria;

  resultsStatus.variations.forEach((variation) => {
    let decisionReached = false;
    for (const rule of rules) {
      const action = evaluateDecisionRuleOnVariation({
        rule,
        variationStatus: variation,
        goalMetrics,
        guardrailMetrics,
        requireSuperStatSig: false,
      });
      if (action) {
        results.push({
          variation: {
            variationId: variation.variationId,
            decidingRule: rule,
          },
          decisionCriteriaAction: action,
        });
        decisionReached = true;
        break;
      }
    }
    if (!decisionReached) {
      // if no decision was reached and power was reached, return the default action
      if (powerReached) {
        results.push({
          variation: {
            variationId: variation.variationId,
            decidingRule: null,
          },
          decisionCriteriaAction: decisionCriteria.defaultAction,
        });
      } else {
        // if no decision was reached and power was not reached (sequential testing), return null
        results.push({
          variation: {
            variationId: variation.variationId,
            decidingRule: null,
          },
          decisionCriteriaAction: null,
        });
      }
    }
  });

  return results;
}

// Early stopping decision criteria requires "super stat sig" status
// and does not use the fallback action, instead preferring to render
// no result
export function getEarlyStoppingVariationDecisions({
  resultsStatus,
  decisionCriteria,
  goalMetrics,
  guardrailMetrics,
}: {
  resultsStatus: ExperimentAnalysisSummaryResultsStatus;
  decisionCriteria: DecisionCriteriaData;
  goalMetrics: string[];
  guardrailMetrics: string[];
}): {
  variation: DecisionFrameworkVariation;
  decisionCriteriaAction: DecisionCriteriaAction | null;
}[] {
  const results: {
    variation: DecisionFrameworkVariation;
    decisionCriteriaAction: DecisionCriteriaAction | null;
  }[] = [];

  const { rules } = decisionCriteria;

  resultsStatus.variations.forEach((variation) => {
    let decisionReached = false;
    for (const rule of rules) {
      const action = evaluateDecisionRuleOnVariation({
        rule,
        variationStatus: variation,
        goalMetrics,
        guardrailMetrics,
        requireSuperStatSig: true,
      });
      if (action) {
        results.push({
          variation: {
            variationId: variation.variationId,
            decidingRule: rule,
          },
          decisionCriteriaAction: action,
        });
        decisionReached = true;
        break;
      }
    }
    // If no decision was reached, return null, ignoring the fallback
    // action since we only want to prematurely stop if the experiment has
    // met one of the explicitly stated criteria with a clear level of
    // evidence
    if (!decisionReached) {
      results.push({
        variation: {
          variationId: variation.variationId,
          decidingRule: null,
        },
        decisionCriteriaAction: null,
      });
    }
  });

  return results;
}
export function getHealthSettings(
  settings?: OrganizationSettings,
  hasDecisionFramework?: boolean,
): ExperimentHealthSettings {
  return {
    decisionFrameworkEnabled:
      (settings?.decisionFrameworkEnabled ??
        DEFAULT_DECISION_FRAMEWORK_ENABLED) &&
      !!hasDecisionFramework,
    experimentMinLengthDays:
      settings?.experimentMinLengthDays ?? DEFAULT_EXPERIMENT_MIN_LENGTH_DAYS,
    srmThreshold: settings?.srmThreshold ?? DEFAULT_SRM_THRESHOLD,
    multipleExposureMinPercent:
      settings?.multipleExposureMinPercent ??
      DEFAULT_MULTIPLE_EXPOSURES_THRESHOLD,
  };
}

export function getDecisionFrameworkStatus({
  resultsStatus,
  decisionCriteria,
  goalMetrics,
  guardrailMetrics,
  daysNeeded,
  scheduledEndPassed,
}: {
  resultsStatus: ExperimentAnalysisSummaryResultsStatus;
  decisionCriteria: DecisionCriteriaData;
  goalMetrics: string[];
  guardrailMetrics: string[];
  daysNeeded?: number;
  // For experiments that are over regardless of power (e.g. a scheduled end
  // date has passed). The returned `powerReached` stays honest.
  scheduledEndPassed?: boolean;
}): ExperimentResultStatusData | undefined {
  const powerReached = daysNeeded === 0;
  const sequentialTesting = resultsStatus?.settings?.sequentialTesting;

  // Rendering a decision with regular stat sig metrics is only valid
  // if you have reached your needed power or if you used sequential testing
  const decisionReady =
    powerReached || sequentialTesting || !!scheduledEndPassed;

  // When the decision is driven solely by the scheduled end passing (not by
  // reaching power), explain that in the tooltip.
  const scheduledEndDrivesDecision = !!scheduledEndPassed && !powerReached;
  const rollbackTooltip = `The test variation(s) should be rolled back.${
    scheduledEndDrivesDecision
      ? " The scheduled end date has passed and a recommendation can be made."
      : ""
  }`;
  const shipTooltip = `A test variation is ready to ship.${
    scheduledEndDrivesDecision
      ? " The scheduled end date has passed and a recommendation can be made."
      : ""
  }`;
  const reviewTooltip = `A test variation is ready to be reviewed.${
    scheduledEndDrivesDecision
      ? " The scheduled end date has passed and there is no clear ship or rollback recommendation."
      : ""
  }`;

  if (decisionReady) {
    const variationDecisions = getVariationDecisions({
      resultsStatus,
      decisionCriteria,
      goalMetrics,
      guardrailMetrics,
      powerReached: powerReached || !!scheduledEndPassed,
    });

    const allRollbackNow =
      variationDecisions.length > 0 &&
      variationDecisions.every((d) => d.decisionCriteriaAction === "rollback");
    if (allRollbackNow) {
      return {
        status: "rollback-now",
        variations: variationDecisions.map(({ variation }) => variation),
        sequentialUsed: sequentialTesting,
        powerReached: powerReached,
        scheduledEndPassed: !!scheduledEndPassed,
        tooltip: rollbackTooltip,
      };
    }

    const shipVariations = variationDecisions.filter(
      (d) => d.decisionCriteriaAction === "ship",
    );
    if (shipVariations.length > 0) {
      return {
        status: "ship-now",
        variations: shipVariations.map(({ variation }) => variation),
        sequentialUsed: sequentialTesting,
        powerReached: powerReached,
        scheduledEndPassed: !!scheduledEndPassed,
        tooltip: shipTooltip,
      };
    }

    // only return ready for review if power is reached, not for premature
    // sequential results
    if (powerReached || scheduledEndPassed) {
      const reviewVariations = variationDecisions.filter(
        (d) => d.decisionCriteriaAction === "review",
      );
      if (reviewVariations.length > 0) {
        return {
          status: "ready-for-review",
          variations: reviewVariations.map(({ variation }) => variation),
          sequentialUsed: sequentialTesting,
          powerReached: powerReached,
          scheduledEndPassed: !!scheduledEndPassed,
          tooltip: reviewTooltip,
        };
      }
    }
  } else {
    // only return ship or rollback for super stat sig metrics
    // using the strict decision criteria
    const earlyStoppingCriteria = PRESET_DECISION_CRITERIA;

    const superStatSigVariationDecisions = getEarlyStoppingVariationDecisions({
      resultsStatus,
      decisionCriteria: earlyStoppingCriteria,
      goalMetrics,
      guardrailMetrics,
    });

    const allRollbackNow =
      superStatSigVariationDecisions.length > 0 &&
      superStatSigVariationDecisions.every(
        (d) => d.decisionCriteriaAction === "rollback",
      );
    if (allRollbackNow) {
      return {
        status: "rollback-now",
        variations: superStatSigVariationDecisions.map(
          ({ variation }) => variation,
        ),
        sequentialUsed: sequentialTesting,
        powerReached: powerReached,
        scheduledEndPassed: false,
        tooltip: rollbackTooltip,
      };
    }

    // Early stopping should only say ship if one variation is a clear winner
    // and all other variations are clearly not winners
    // So only early stop if you have met shipping criteria with stat sig
    // status and all other variations are rollback

    // For two-armed variations, this means if the one variation is ready to ship
    // early, then we recommend shipping, so this only slows down early shipping
    // if you have many arms, where it requires more logic to determine if you have
    // a clear winner
    const shipVariations = superStatSigVariationDecisions.filter(
      (d) => d.decisionCriteriaAction === "ship",
    );
    const onlyOneShip = shipVariations.length === 1;
    const numberOfRollbackVariations = superStatSigVariationDecisions.filter(
      (d) => d.decisionCriteriaAction === "rollback",
    ).length;

    const restRollback =
      numberOfRollbackVariations === superStatSigVariationDecisions.length - 1;

    if (onlyOneShip && restRollback) {
      return {
        status: "ship-now",
        variations: shipVariations.map(({ variation }) => variation),
        sequentialUsed: sequentialTesting,
        powerReached: powerReached,
        scheduledEndPassed: false,
        tooltip: shipTooltip,
      };
    }
  }
}

function getDaysLeftStatus({
  daysNeeded,
}: {
  daysNeeded: number;
}): DecisionFrameworkExperimentRecommendationStatus | undefined {
  // TODO: Right now midExperimentPowerEnable is controlling the whole "Days Left" status
  // but we should probably split it when considering Experiment Runtime length without power
  if (daysNeeded > 0) {
    return {
      status: "days-left",
      daysLeft: daysNeeded,
    };
  }
}

export function getExperimentResultStatus({
  experimentData,
  healthSettings,
  decisionCriteria,
}: {
  experimentData: ExperimentDataForStatus | ExperimentDataForStatusStringDates;
  healthSettings: ExperimentHealthSettings;
  decisionCriteria: DecisionCriteriaData;
}): ExperimentResultStatusData | undefined {
  const unhealthyData: ExperimentUnhealthyData = {};
  const healthSummary = experimentData.analysisSummary?.health;
  const resultsStatus = experimentData.analysisSummary?.resultsStatus;
  const type = experimentData.type === "holdout" ? "holdout" : "experiment";
  const lastPhase = experimentData.phases[experimentData.phases.length - 1];
  const beforeMinDuration =
    lastPhase?.dateStarted &&
    daysBetween(lastPhase.dateStarted, new Date()) <
      healthSettings.experimentMinLengthDays;

  const withinFirstDay = lastPhase?.dateStarted
    ? daysBetween(lastPhase.dateStarted, new Date()) < 1
    : false;

  const isLowPowered =
    healthSummary?.power?.type === "success"
      ? healthSummary.power.isLowPowered
      : undefined;
  const daysNeeded =
    healthSummary?.power?.type === "success"
      ? healthSummary.power.additionalDaysNeeded
      : undefined;

  // Past its scheduled end, the experiment is over regardless of power, so
  // render a decision even if the target MDE hasn't been reached.
  const scheduledStopAt = experimentData.statusUpdateSchedule?.stopAt;
  const scheduledEndPassed =
    experimentData.status === "running" &&
    !!scheduledStopAt &&
    getValidDate(scheduledStopAt) <= new Date();

  // Fully skip decision framework if there are no goal metrics
  // TODO @dmf-experiment: Add front-end information about this
  let decisionStatus: ExperimentResultStatusData | undefined = undefined;
  if (experimentData.goalMetrics.length && resultsStatus) {
    decisionStatus = getDecisionFrameworkStatus({
      resultsStatus,
      decisionCriteria,
      goalMetrics: experimentData.goalMetrics,
      guardrailMetrics: experimentData.guardrailMetrics,
      daysNeeded,
      scheduledEndPassed,
    });
  }

  const daysLeftStatus = daysNeeded
    ? getDaysLeftStatus({ daysNeeded })
    : undefined;

  if (healthSummary?.totalUsers) {
    const srmHealthData = getSRMHealthData({
      srm: healthSummary.srm,
      srmThreshold: healthSettings.srmThreshold,
      totalUsersCount: healthSummary.totalUsers,
      numOfVariations: getLatestPhaseVariations(experimentData).length,
      minUsersPerVariation:
        experimentData.type === "multi-armed-bandit"
          ? DEFAULT_SRM_BANDIT_MINIMINUM_COUNT_PER_VARIATION
          : DEFAULT_SRM_MINIMINUM_COUNT_PER_VARIATION,
    });

    if (srmHealthData === "unhealthy") {
      unhealthyData.srm = true;
    }

    if (healthSummary.covariateImbalance?.isImbalanced) {
      unhealthyData.covariateImbalance = true;
    }

    const multipleExposuresHealthData = getMultipleExposureHealthData({
      multipleExposuresCount: healthSummary.multipleExposures,
      totalUsersCount: healthSummary.totalUsers,
      minCountThreshold: DEFAULT_MULTIPLE_EXPOSURES_ENOUGH_DATA_THRESHOLD,
      minPercentThreshold: healthSettings.multipleExposureMinPercent,
    });

    if (multipleExposuresHealthData.status === "unhealthy") {
      unhealthyData.multipleExposures = {
        rawDecimal: multipleExposuresHealthData.rawDecimal,
        multipleExposedUsers: healthSummary.multipleExposures,
      };
    }

    if (
      isLowPowered &&
      healthSettings.decisionFrameworkEnabled &&
      // override low powered status if shipping criteria are ready
      // or before min duration
      !decisionStatus &&
      !beforeMinDuration &&
      // ignore if user has dismissed the warning
      !experimentData.dismissedWarnings?.includes("low-power")
    ) {
      unhealthyData.lowPowered = true;
    }
  }

  const unhealthyStatuses = [
    ...(unhealthyData.srm ? ["SRM"] : []),
    ...(unhealthyData.multipleExposures ? ["Multiple exposures"] : []),
    ...(unhealthyData.lowPowered ? ["Low powered"] : []),
    ...(unhealthyData.covariateImbalance ? ["Pre-exposure bias"] : []),
  ];
  // 1. Always show unhealthy status if they exist
  if (unhealthyStatuses.length > 0) {
    return {
      status: "unhealthy",
      unhealthyData: unhealthyData,
      tooltip: unhealthyStatuses.join(", "),
    };
  }

  // 2. Show no data if no data is present
  if (healthSummary?.totalUsers === 0 && !withinFirstDay) {
    return {
      status: "no-data",
    };
  }

  // 2.5 - No data source configured for experiment
  if (!experimentData.datasource) {
    return {
      status: "no-data",
      tooltip: `No data source configured for ${type}`,
    };
  }

  // 2.6 - No metrics configured for experiment
  if (
    !experimentData.goalMetrics?.length &&
    !experimentData.secondaryMetrics?.length &&
    !experimentData.guardrailMetrics?.length
  ) {
    return {
      status: "no-data",
      tooltip: `No metrics configured for ${type} yet`,
    };
  }

  // 3. If early in the experiment, just say running with a tooltip
  if (beforeMinDuration) {
    return {
      status: "before-min-duration",
      tooltip: `Estimated days left or decision recommendations will appear after the minimum experiment duration of ${healthSettings.experimentMinLengthDays} is reached.`,
    };
  }

  if (healthSettings.decisionFrameworkEnabled) {
    // 4. if clear shipping status, show it
    if (decisionStatus) {
      return decisionStatus;
    }

    // 5. If no unhealthy status or clear shipping criteria, show days left data
    if (daysLeftStatus) {
      return daysLeftStatus;
    }
  }
}

export function getSafeRolloutDaysLeft({
  safeRollout,
  snapshotWithResults,
}: {
  safeRollout: SafeRolloutInterface;
  snapshotWithResults?: SafeRolloutSnapshotInterface;
}) {
  // Use latest snapshot date and safe rollout start date plus maxDurationDays to determine days left
  const startDate = safeRollout.startedAt
    ? new Date(safeRollout.startedAt)
    : new Date();
  const endDate = addDays(startDate, safeRollout?.maxDuration?.amount); // TODO: Add unit
  const latestSnapshotDate = snapshotWithResults?.runStarted
    ? new Date(snapshotWithResults?.runStarted)
    : null;

  const daysLeft = latestSnapshotDate
    ? differenceInMinutes(endDate, latestSnapshotDate) / 1440
    : safeRollout?.maxDuration?.amount; // TODO: Add unit

  return daysLeft;
}

export function getSafeRolloutResultStatus({
  safeRollout,
  healthSettings,
  daysLeft,
}: {
  safeRollout: SafeRolloutInterface;
  healthSettings: ExperimentHealthSettings;
  daysLeft: number;
}): ExperimentResultStatusData | undefined {
  const unhealthyData: ExperimentUnhealthyData = {};
  const healthSummary = safeRollout.analysisSummary?.health;
  const resultsStatus = safeRollout.analysisSummary?.resultsStatus;
  const hoursRunning = differenceInHours(
    Date.now(),
    safeRollout.startedAt ? new Date(safeRollout.startedAt) : Date.now(),
  );

  // If the safe rollout has been running for over 24 hours and no data has come in
  // return no data
  if (!healthSummary?.totalUsers && hoursRunning > 24) {
    return {
      status: "no-data",
    };
  } else if (healthSummary?.totalUsers) {
    const srmHealthData = getSRMHealthData({
      srm: healthSummary.srm,
      srmThreshold: healthSettings.srmThreshold,
      totalUsersCount: healthSummary.totalUsers,
      numOfVariations: 2,
      minUsersPerVariation: DEFAULT_SRM_MINIMINUM_COUNT_PER_VARIATION,
    });

    if (srmHealthData === "unhealthy") {
      unhealthyData.srm = true;
    }

    const multipleExposuresHealthData = getMultipleExposureHealthData({
      multipleExposuresCount: healthSummary.multipleExposures,
      totalUsersCount: healthSummary.totalUsers,
      minCountThreshold: DEFAULT_MULTIPLE_EXPOSURES_ENOUGH_DATA_THRESHOLD,
      minPercentThreshold: healthSettings.multipleExposureMinPercent,
    });

    if (multipleExposuresHealthData.status === "unhealthy") {
      unhealthyData.multipleExposures = {
        rawDecimal: multipleExposuresHealthData.rawDecimal,
        multipleExposedUsers: healthSummary.multipleExposures,
      };
    }
  }

  const ROLLBACK_SAFE_ROLLOUT_DECISION_CRITERIA: DecisionCriteriaData = {
    id: "gbdeccrit_rollback_safe_rollout",
    name: "Rollback Safe Rollout",
    description: "",
    rules: [
      {
        conditions: [
          {
            match: "any",
            metrics: "guardrails",
            direction: "statsigLoser",
          },
        ],
        action: "rollback",
      },
    ],
    defaultAction: "review",
  };

  const decisionStatus = resultsStatus
    ? getDecisionFrameworkStatus({
        resultsStatus,
        decisionCriteria: ROLLBACK_SAFE_ROLLOUT_DECISION_CRITERIA,
        goalMetrics: [],
        guardrailMetrics: safeRollout.guardrailMetricIds,
        daysNeeded: Infinity, // sequential relied upon solely for safe rollouts
      })
    : undefined;

  // If unhealthy, return unhealthy status
  if (unhealthyData.srm || unhealthyData.multipleExposures) {
    return {
      status: "unhealthy",
      unhealthyData,
    };
  }

  // If rollback now, return rollback now
  if (decisionStatus?.status === "rollback-now") {
    return {
      status: "rollback-now",
      variations: decisionStatus.variations,
      sequentialUsed: true,
      powerReached: false,
      scheduledEndPassed: false,
    };
  }

  // If no decision status, return days left status
  if (daysLeft > 0) {
    return {
      status: "days-left",
      daysLeft,
    };
  }

  if (daysLeft <= 0 && resultsStatus) {
    // If no days left, return ship decision
    return {
      status: "ship-now",
      variations: [
        {
          variationId: "1",
          decidingRule: null,
        },
      ],
      sequentialUsed: true,
      powerReached: false,
      scheduledEndPassed: false,
    };
  }
}

export function getPresetDecisionCriteriaForOrg(
  settings?: OrganizationSettings,
) {
  return !settings?.defaultDecisionCriteriaId
    ? PRESET_DECISION_CRITERIA
    : PRESET_DECISION_CRITERIAS.find(
        (dc) => dc.id === settings.defaultDecisionCriteriaId,
      );
}

// Pure mapping of a snapshot dimension's variations to their tiebreaker-metric
// relative lift, keyed by the snapshot's own variation ids (index-aligned with
// the analysis results). Callers own loading the snapshot/metric.
export function buildTiebreakerLiftMap({
  variations,
  snapshotVariationIds,
  metricId,
  inverse,
}: {
  variations: SnapshotVariation[];
  snapshotVariationIds: string[];
  metricId: string;
  inverse?: boolean;
}): Record<string, number> | null {
  // For a lower-is-better (inverse) metric, flip the sign so that "highest
  // lift" selects the best variation, not the worst. `expected` is the raw
  // relative lift and is not direction-adjusted.
  const sign = inverse ? -1 : 1;
  const map: Record<string, number> = {};
  variations.forEach((dv, i) => {
    const id = snapshotVariationIds[i];
    const expected = dv?.metrics?.[metricId]?.expected;
    if (id && typeof expected === "number") map[id] = expected * sign;
  });
  return Object.keys(map).length > 0 ? map : null;
}

export type ScheduledShipDecision =
  | { action: "ship"; variationId: string }
  | { action: "no-winner" };

/**
 * Resolve the auto-ship decision at an experiment's scheduled end, given the
 * decision-framework result status.
 *  - A single ship-now winner ships directly.
 *  - Multiple ship-now winners are an ambiguous tie: if a tiebreaker metric's
 *    relative lift is provided per variation, ship the one with the highest
 *    lift; otherwise there's no clear winner.
 *  - Anything else (rollback / review / inconclusive) has no clear winner.
 * The caller owns the fallback (notify vs force-ship a chosen variation).
 */
export function resolveScheduledShipDecision({
  resultStatus,
  tiebreakerLiftByVariationId,
}: {
  resultStatus: ExperimentResultStatusData | undefined;
  tiebreakerLiftByVariationId?: Record<string, number> | null;
}): ScheduledShipDecision {
  if (resultStatus?.status !== "ship-now") return { action: "no-winner" };

  const variations = resultStatus.variations;
  if (variations.length === 1) {
    return { action: "ship", variationId: variations[0].variationId };
  }
  if (variations.length === 0) return { action: "no-winner" };

  // Ambiguous multi-winner tie — break by highest lift on the tiebreaker metric.
  if (!tiebreakerLiftByVariationId) return { action: "no-winner" };
  let winner: string | null = null;
  let bestLift = -Infinity;
  for (const v of variations) {
    const lift = tiebreakerLiftByVariationId[v.variationId];
    if ((lift ?? null) === null) continue;
    if (lift > bestLift) {
      bestLift = lift;
      winner = v.variationId;
    }
  }
  return winner !== null
    ? { action: "ship", variationId: winner }
    : { action: "no-winner" };
}
