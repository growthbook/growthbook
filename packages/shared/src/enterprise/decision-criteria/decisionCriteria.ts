import { addDays, differenceInDays } from "date-fns";
import {
  DecisionCriteriaAction,
  DecisionCriteriaData,
  DecisionCriteriaRule,
  DecisionFrameworkExperimentRecommendationStatus,
  ExperimentAnalysisSummaryResultsStatus,
  ExperimentAnalysisSummaryVariationStatus,
  ExperimentDataForStatus,
  ExperimentDataForStatusStringDates,
  ExperimentHealthSettings,
  ExperimentResultStatusData,
  ExperimentUnhealthyData,
} from "back-end/types/experiment";
import {
  SafeRolloutInterface,
  SafeRolloutSnapshotInterface,
} from "back-end/types/safe-rollout";
import { OrganizationSettings } from "back-end/types/organization";
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
  DEFAULT_DECISION_CRITERIA,
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
          (m) => metricResults?.[m]?.[fieldToCheck] === desiredStatus
        );
      } else if (condition.match === "any") {
        return metrics.some(
          (m) => metricResults?.[m]?.[fieldToCheck] === desiredStatus
        );
      } else if (condition.match === "none") {
        return metrics.every(
          (m) => metricResults?.[m]?.[fieldToCheck] !== desiredStatus
        );
      }
    } else if (condition.metrics === "guardrails") {
      const metrics = guardrailMetrics;
      const metricResults = variationStatus.guardrailMetrics;

      if (condition.match === "all") {
        return metrics.every(
          (m) => metricResults?.[m]?.status === desiredStatus
        );
      } else if (condition.match === "any") {
        return metrics.some(
          (m) => metricResults?.[m]?.status === desiredStatus
        );
      } else if (condition.match === "none") {
        return metrics.every(
          (m) => metricResults?.[m]?.status !== desiredStatus
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
  goalMetrics,
  guardrailMetrics,
  requireSuperStatSig,
}: {
  resultsStatus: ExperimentAnalysisSummaryResultsStatus;
  decisionCriteria: DecisionCriteriaData;
  goalMetrics: string[];
  guardrailMetrics: string[];
  requireSuperStatSig: boolean;
}): {
  variationId: string;
  decisionCriteriaAction: DecisionCriteriaAction;
}[] {
  const results: {
    variationId: string;
    decisionCriteriaAction: DecisionCriteriaAction;
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
        requireSuperStatSig,
      });
      if (action) {
        results.push({
          variationId: variation.variationId,
          decisionCriteriaAction: action,
        });
        decisionReached = true;
        break;
      }
    }
    // If no decision was reached, use the default action from the
    // decision criteria
    if (!decisionReached) {
      results.push({
        variationId: variation.variationId,
        decisionCriteriaAction: decisionCriteria.defaultAction,
      });
    }
  });

  return results;
}

export function getHealthSettings(
  settings?: OrganizationSettings,
  hasDecisionFramework?: boolean
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

  // Rendering a decision with regular stat sig metrics is only valid
  // if you have reached your needed power or if you used sequential testing
  const decisionReady = powerReached || sequentialTesting;

  const tooltipLanguage = powerReached
    ? ` and experiment has reached the target statistical power.`
    : sequentialTesting
    ? ` and sequential testing is enabled, allowing decisions as soon as statistical significance is reached.`
    : ".";

  if (decisionReady) {
    const variationDecisions = getVariationDecisions({
      resultsStatus,
      decisionCriteria,
      goalMetrics,
      guardrailMetrics,
      requireSuperStatSig: false,
    });

    const allRollbackNow =
      variationDecisions.length > 0 &&
      variationDecisions.every((d) => d.decisionCriteriaAction === "rollback");
    if (allRollbackNow) {
      return {
        status: "rollback-now",
        variationIds: variationDecisions.map(({ variationId }) => variationId),
        sequentialUsed: sequentialTesting,
        powerReached: powerReached,
        tooltip: `Guardrails are failing and/or goal metrics are not improving for all variations ${tooltipLanguage}`,
      };
    }

    const anyShipNow = variationDecisions.some(
      (d) => d.decisionCriteriaAction === "ship"
    );
    if (anyShipNow) {
      return {
        status: "ship-now",
        variationIds: variationDecisions
          .filter((d) => d.decisionCriteriaAction === "ship")
          .map(({ variationId }) => variationId),
        sequentialUsed: sequentialTesting,
        powerReached: powerReached,
        tooltip: `Goal metrics are improving for a test variation with no failing guardrails ${tooltipLanguage}`,
      };
    }

    // only return ready for review if power is reached, not for premature
    // sequential results
    if (powerReached) {
      if (
        variationDecisions.some((d) => d.decisionCriteriaAction === "review")
      ) {
        return {
          status: "ready-for-review",
          variationIds: variationDecisions
            .filter((d) => d.decisionCriteriaAction === "review")
            .map(({ variationId }) => variationId),
          sequentialUsed: sequentialTesting,
          powerReached: powerReached,
          tooltip: `The experiment has reached the target statistical power but the results are not conclusive.`,
        };
      }
    }
  } else {
    // only return ship or rollback for super stat sig metrics
    const superStatSigVariationDecisions = getVariationDecisions({
      resultsStatus,
      decisionCriteria,
      goalMetrics,
      guardrailMetrics,
      requireSuperStatSig: true,
    });

    const allRollbackNow =
      superStatSigVariationDecisions.length > 0 &&
      superStatSigVariationDecisions.every(
        (d) => d.decisionCriteriaAction === "rollback"
      );
    if (allRollbackNow) {
      return {
        status: "rollback-now",
        variationIds: superStatSigVariationDecisions.map(
          ({ variationId }) => variationId
        ),
        sequentialUsed: sequentialTesting,
        powerReached: powerReached,
        tooltip: `The experiment has not reached the target statistical power, however there are strong negative signals for all test variations.`,
      };
    }

    const anyShipNow = superStatSigVariationDecisions.some(
      (d) => d.decisionCriteriaAction === "ship"
    );
    if (anyShipNow) {
      return {
        status: "ship-now",
        variationIds: superStatSigVariationDecisions
          .filter((d) => d.decisionCriteriaAction === "ship")
          .map(({ variationId }) => variationId),
        sequentialUsed: sequentialTesting,
        powerReached: powerReached,
        tooltip: `The experiment has not reached the target statistical power, however there are strong positive signals for a test variation.`,
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

  const decisionStatus = resultsStatus
    ? getDecisionFrameworkStatus({
        resultsStatus,
        decisionCriteria,
        goalMetrics: experimentData.goalMetrics,
        guardrailMetrics: experimentData.guardrailMetrics,
        daysNeeded,
      })
    : undefined;

  const daysLeftStatus = daysNeeded
    ? getDaysLeftStatus({ daysNeeded })
    : undefined;

  if (healthSummary?.totalUsers) {
    const srmHealthData = getSRMHealthData({
      srm: healthSummary.srm,
      srmThreshold: healthSettings.srmThreshold,
      totalUsersCount: healthSummary.totalUsers,
      numOfVariations: experimentData.variations.length,
      minUsersPerVariation:
        experimentData.type === "multi-armed-bandit"
          ? DEFAULT_SRM_BANDIT_MINIMINUM_COUNT_PER_VARIATION
          : DEFAULT_SRM_MINIMINUM_COUNT_PER_VARIATION,
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
      tooltip: "No data source configured for experiment",
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
      tooltip: "No metrics configured for experiment yet",
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
    ? differenceInDays(endDate, latestSnapshotDate)
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

  if (healthSummary?.totalUsers) {
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

  // If rollback now, return rollback now
  if (decisionStatus?.status === "rollback-now") {
    return {
      status: "rollback-now",
      variationIds: decisionStatus.variationIds,
      sequentialUsed: true,
      powerReached: false,
    };
  }

  // If unhealthy, return unhealthy status
  if (unhealthyData.srm || unhealthyData.multipleExposures) {
    return {
      status: "unhealthy",
      unhealthyData,
    };
  }

  // If no decision status, return days left status
  if (daysLeft > 0) {
    return {
      status: "days-left",
      daysLeft,
    };
  }

  if (daysLeft <= 0) {
    // If no days left, return ship decision
    return {
      status: "ship-now",
      variationIds: ["1"],
      sequentialUsed: true,
      powerReached: false,
    };
  }
}

export function getPresetDecisionCriteriaForOrg(
  settings?: OrganizationSettings
) {
  return !settings?.defaultDecisionCriteriaId
    ? DEFAULT_DECISION_CRITERIA
    : PRESET_DECISION_CRITERIAS.find(
        (dc) => dc.id === settings.defaultDecisionCriteriaId
      );
}
