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
import { daysBetween } from "../../dates";
import { getMultipleExposureHealthData, getSRMHealthData } from "../../health";
import {
  PRESET_DECISION_CRITERIA,
  PRESET_DECISION_CRITERIAS,
} from "./constants";

// Resolve how a single condition's direction should be evaluated.
// - `desiredStatus`: the metric status that satisfies the direction
// - `fieldToCheck`: regular stat sig (`status`) vs super stat sig
//   (`superStatSigStatus`), encoded directly by the direction
// - `suppressed`: regular `statsigWinner` is unreliable before the experiment
//   is decision-ready (target power reached or sequential testing enabled), so
//   it is treated as "not matching" until then. This implements the asymmetry:
//   detect harm early (regular `statsigLoser` always evaluates), but do not
//   declare victory early on regular stat sig.
function resolveDirectionEval(
  direction: DecisionCriteriaRule["conditions"][number]["direction"],
  decisionReady: boolean,
): {
  desiredStatus: "won" | "lost";
  fieldToCheck: "status" | "superStatSigStatus";
  suppressed: boolean;
} {
  const isWinner =
    direction === "statsigWinner" || direction === "superStatsigWinner";
  const isSuper =
    direction === "superStatsigWinner" || direction === "superStatsigLoser";
  return {
    desiredStatus: isWinner ? "won" : "lost",
    fieldToCheck: isSuper ? "superStatSigStatus" : "status",
    suppressed: direction === "statsigWinner" && !decisionReady,
  };
}

// Evaluate a single rule on a variation result
// Returns the action and the metric IDs that triggered it, or undefined
export function evaluateDecisionRuleOnVariation({
  rule,
  variationStatus,
  goalMetrics,
  guardrailMetrics,
  decisionReady,
}: {
  rule: DecisionCriteriaRule;
  variationStatus: ExperimentAnalysisSummaryVariationStatus;
  goalMetrics: string[];
  guardrailMetrics: string[];
  // Whether regular stat sig results can be acted on (target power reached or
  // sequential testing enabled). Controls suppression of regular `statsigWinner`.
  decisionReady: boolean;
}):
  | { action: DecisionCriteriaAction; triggeredMetricIds: string[] }
  | undefined {
  const { conditions, action } = rule;

  // Track which metric IDs matched across all conditions for this rule
  const allTriggeredMetricIds: string[] = [];

  const allConditionsMet = conditions.every((condition) => {
    const { desiredStatus, fieldToCheck, suppressed } = resolveDirectionEval(
      condition.direction,
      decisionReady,
    );
    if (condition.metrics === "goals") {
      const metrics = goalMetrics;
      const metricResults = variationStatus.goalMetrics;

      const metricMatches = (m: string) =>
        !suppressed && metricResults?.[m]?.[fieldToCheck] === desiredStatus;

      if (condition.match === "all") {
        const matched = metrics.every(metricMatches);
        if (matched) allTriggeredMetricIds.push(...metrics);
        return matched;
      } else if (condition.match === "any") {
        const matching = metrics.filter(metricMatches);
        if (matching.length > 0) allTriggeredMetricIds.push(...matching);
        return matching.length > 0;
      } else if (condition.match === "none") {
        return metrics.every((m) => !metricMatches(m));
      }
    } else if (condition.metrics === "guardrails") {
      const metrics = guardrailMetrics;
      const metricResults = variationStatus.guardrailMetrics;

      // Guardrail results only carry a regular `status` (no super stat sig
      // variant), so guardrail conditions always evaluate against `status`.
      const metricMatches = (m: string) =>
        !suppressed && metricResults?.[m]?.status === desiredStatus;

      if (condition.match === "all") {
        const matched = metrics.every(metricMatches);
        if (matched) allTriggeredMetricIds.push(...metrics);
        return matched;
      } else if (condition.match === "any") {
        const matching = metrics.filter(metricMatches);
        if (matching.length > 0) allTriggeredMetricIds.push(...matching);
        return matching.length > 0;
      } else if (condition.match === "none") {
        return metrics.every((m) => !metricMatches(m));
      }
    }
  });

  if (allConditionsMet) {
    return { action, triggeredMetricIds: allTriggeredMetricIds };
  }

  return undefined;
}

// Whether a ship rule is allowed to fire before the experiment is
// decision-ready. Early shipping must be explicitly opted into with a
// `superStatsigWinner` condition so that we never "declare victory early"
// based purely on regular stat sig or on the absence of harm.
function shipRuleAllowedPrePower(rule: DecisionCriteriaRule): boolean {
  return rule.conditions.some((c) => c.direction === "superStatsigWinner");
}

// Get the decision for each variation based on the decision criteria
export function getVariationDecisions({
  resultsStatus,
  decisionCriteria,
  powerReached,
  decisionReady,
  goalMetrics,
  guardrailMetrics,
}: {
  resultsStatus: ExperimentAnalysisSummaryResultsStatus;
  decisionCriteria: DecisionCriteriaData;
  // Whether the experiment has reached target power. Controls whether the
  // `defaultAction` fallback is applied when no rule matches.
  powerReached: boolean;
  // Whether regular stat sig results can be acted on (target power reached or
  // sequential testing enabled). Controls suppression of regular `statsigWinner`
  // and the pre-power ship guard.
  decisionReady: boolean;
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
      // Pre-power ship guard: only ship early when an explicit
      // `superStatsigWinner` condition provides positive evidence.
      if (
        !decisionReady &&
        rule.action === "ship" &&
        !shipRuleAllowedPrePower(rule)
      ) {
        continue;
      }
      const result = evaluateDecisionRuleOnVariation({
        rule,
        variationStatus: variation,
        goalMetrics,
        guardrailMetrics,
        decisionReady,
      });
      if (result) {
        results.push({
          variation: {
            variationId: variation.variationId,
            decidingRule: rule,
            triggeredMetricIds: result.triggeredMetricIds,
          },
          decisionCriteriaAction: result.action,
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
        // if no decision was reached and power was not reached, return null.
        // We only prematurely stop when an explicitly stated rule matches with
        // a clear level of evidence; the fallback action is not applied.
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
}: {
  resultsStatus: ExperimentAnalysisSummaryResultsStatus;
  decisionCriteria: DecisionCriteriaData;
  goalMetrics: string[];
  guardrailMetrics: string[];
  daysNeeded?: number;
}): ExperimentResultStatusData | undefined {
  const powerReached = daysNeeded === 0;
  const sequentialTesting = resultsStatus?.settings?.sequentialTesting;

  // Regular stat sig results are only valid to act on once the experiment is
  // decision-ready: target power is reached or sequential testing is enabled.
  const decisionReady = powerReached || !!sequentialTesting;

  const rollbackTooltip = `The test variation(s) should be rolled back.`;
  const shipTooltip = `A test variation is ready to ship.`;
  const reviewTooltip = `A test variation is ready to be reviewed.`;

  // Always evaluate the user's own decision criteria. Direction-level gating
  // (regular `statsigWinner` suppressed pre-power, super stat sig always
  // evaluated) and the pre-power ship guard are handled inside
  // getVariationDecisions, so there is no separate early-stopping path.
  const variationDecisions = getVariationDecisions({
    resultsStatus,
    decisionCriteria,
    goalMetrics,
    guardrailMetrics,
    powerReached,
    decisionReady,
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
      tooltip: rollbackTooltip,
    };
  }

  const shipVariations = variationDecisions.filter(
    (d) => d.decisionCriteriaAction === "ship",
  );
  if (decisionReady) {
    if (shipVariations.length > 0) {
      return {
        status: "ship-now",
        variations: shipVariations.map(({ variation }) => variation),
        sequentialUsed: sequentialTesting,
        powerReached: powerReached,
        tooltip: shipTooltip,
      };
    }
  } else {
    // Pre-power early shipping should only say ship if one variation is a clear
    // winner and all other variations are clearly rollbacks. For two-armed
    // experiments this ships as soon as the single test variation qualifies;
    // it only slows down early shipping with many arms, where determining a
    // clear winner requires the others to be rollbacks.
    const onlyOneShip = shipVariations.length === 1;
    const numberOfRollbackVariations = variationDecisions.filter(
      (d) => d.decisionCriteriaAction === "rollback",
    ).length;
    const restRollback =
      numberOfRollbackVariations === variationDecisions.length - 1;

    if (onlyOneShip && restRollback) {
      return {
        status: "ship-now",
        variations: shipVariations.map(({ variation }) => variation),
        sequentialUsed: sequentialTesting,
        powerReached: powerReached,
        tooltip: shipTooltip,
      };
    }
  }

  // only return ready for review if power is reached, not for premature
  // sequential or super-stat-sig results
  if (powerReached) {
    const reviewVariations = variationDecisions.filter(
      (d) => d.decisionCriteriaAction === "review",
    );
    if (reviewVariations.length > 0) {
      return {
        status: "ready-for-review",
        variations: reviewVariations.map(({ variation }) => variation),
        sequentialUsed: sequentialTesting,
        powerReached: powerReached,
        tooltip: reviewTooltip,
      };
    }
  }
}

/**
 * Mid-ramp EDF evaluation. Uses the experiment's own decision criteria with
 * the directions encoding their own thresholds. Returns review-now,
 * rollback-now, or ship-now if any variation triggers a rule; otherwise undefined.
 *
 * This is called at every ramp step evaluation and is NOT gated on power
 * or sequential testing having been reached, so it runs as `decisionReady`
 * is false: regular `statsigLoser` detects harm early, regular `statsigWinner`
 * is suppressed, and shipping early requires an explicit `superStatsigWinner`
 * condition.
 */
export function getMidRampDecisionStatus({
  resultsStatus,
  decisionCriteria,
  goalMetrics,
  guardrailMetrics,
}: {
  resultsStatus: ExperimentAnalysisSummaryResultsStatus;
  decisionCriteria: DecisionCriteriaData;
  goalMetrics: string[];
  guardrailMetrics: string[];
}): ExperimentResultStatusData | undefined {
  const variationDecisions = getVariationDecisions({
    resultsStatus,
    decisionCriteria,
    goalMetrics,
    guardrailMetrics,
    powerReached: false,
    decisionReady: false,
  });

  const allRollbackNow =
    variationDecisions.length > 0 &&
    variationDecisions.every((d) => d.decisionCriteriaAction === "rollback");
  if (allRollbackNow) {
    return {
      status: "rollback-now",
      variations: variationDecisions.map(({ variation }) => variation),
      sequentialUsed: false,
      powerReached: false,
      tooltip: "All variations should be rolled back based on current data.",
    };
  }

  const reviewVariations = variationDecisions.filter(
    (d) => d.decisionCriteriaAction === "review",
  );
  if (reviewVariations.length > 0) {
    return {
      status: "review-now",
      variations: reviewVariations.map(({ variation }) => variation),
    };
  }

  const shipVariations = variationDecisions.filter(
    (d) => d.decisionCriteriaAction === "ship",
  );
  const onlyOneShip = shipVariations.length === 1;
  const numberOfRollbackVariations = variationDecisions.filter(
    (d) => d.decisionCriteriaAction === "rollback",
  ).length;
  const restRollback =
    numberOfRollbackVariations === variationDecisions.length - 1;

  if (onlyOneShip && restRollback) {
    return {
      status: "ship-now",
      variations: shipVariations.map(({ variation }) => variation),
      sequentialUsed: false,
      powerReached: false,
      tooltip: "A test variation is a clear winner based on current data.",
    };
  }

  return undefined;
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
  noTrafficGracePeriodHours,
  monitoringStartedAt,
}: {
  experimentData: ExperimentDataForStatus | ExperimentDataForStatusStringDates;
  healthSettings: ExperimentHealthSettings;
  decisionCriteria: DecisionCriteriaData;
  /**
   * Optional: for ramp-monitored experiments, suppress "no-data" until this
   * many hours have elapsed since monitoringStartedAt. This gives the experiment
   * time to accumulate traffic before the no-data action fires.
   * Defaults to 0 (no grace period) when not provided, preserving existing behavior.
   */
  noTrafficGracePeriodHours?: number;
  /** Timestamp when ramp monitoring started. Required when noTrafficGracePeriodHours is set. */
  monitoringStartedAt?: Date | string | null;
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

  // Grace period check: suppress no-data until the grace period has elapsed
  const withinNoTrafficGracePeriod =
    noTrafficGracePeriodHours != null &&
    noTrafficGracePeriodHours > 0 &&
    monitoringStartedAt != null &&
    differenceInHours(new Date(), new Date(monitoringStartedAt)) <
      noTrafficGracePeriodHours;

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

  // 2. Show no data if no data is present (suppressed during grace period)
  if (
    healthSummary?.totalUsers === 0 &&
    !withinFirstDay &&
    !withinNoTrafficGracePeriod
  ) {
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
