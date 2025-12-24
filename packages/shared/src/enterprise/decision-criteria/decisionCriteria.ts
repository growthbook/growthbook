import { addDays, differenceInHours, differenceInMinutes } from "date-fns";
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
  variation: DecisionFrameworkVariation;
  decisionCriteriaAction: DecisionCriteriaAction;
}[] {
  const results: {
    variation: DecisionFrameworkVariation;
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
    // If no decision was reached, use the default action from the
    // decision criteria
    if (!decisionReached) {
      results.push({
        variation: {
          variationId: variation.variationId,
          decidingRule: null,
        },
        decisionCriteriaAction: decisionCriteria.defaultAction,
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

  const rollbackTooltip = `The test variation(s) should be rolled back.`;
  const shipTooltip = `A test variation is ready to ship.`;
  const reviewTooltip = `A test variation is ready to be reviewed.`;

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
        variations: variationDecisions.map(({ variation }) => variation),
        sequentialUsed: sequentialTesting,
        powerReached: powerReached,
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
        tooltip: shipTooltip,
      };
    }

    // only return ready for review if power is reached, not for premature
    // sequential results
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
        tooltip: rollbackTooltip,
      };
    }

    const shipVariations = superStatSigVariationDecisions.filter(
      (d) => d.decisionCriteriaAction === "ship",
    );
    if (shipVariations.length > 0) {
      return {
        status: "ship-now",
        variations: shipVariations.map(({ variation }) => variation),
        sequentialUsed: sequentialTesting,
        powerReached: powerReached,
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
