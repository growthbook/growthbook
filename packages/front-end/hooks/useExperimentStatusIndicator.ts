import {
  DEFAULT_MULTIPLE_EXPOSURES_THRESHOLD,
  DEFAULT_SRM_MINIMINUM_COUNT_PER_VARIATION,
  DEFAULT_SRM_BANDIT_MINIMINUM_COUNT_PER_VARIATION,
  DEFAULT_SRM_THRESHOLD,
  DEFAULT_EXPERIMENT_MIN_LENGTH_DAYS,
  DEFAULT_EXPERIMENT_MAX_LENGTH_DAYS,
  DEFAULT_DECISION_FRAMEWORK_ENABLED,
  DEFAULT_MULTIPLE_EXPOSURES_ENOUGH_DATA_THRESHOLD,
} from "shared/constants";
import { daysBetween } from "shared/dates";
import { getMultipleExposureHealthData, getSRMHealthData } from "shared/health";
import {
  DecisionFrameworkData,
  ExperimentAnalysisSummaryResultsStatus,
  ExperimentInterfaceStringDates,
} from "back-end/types/experiment";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useUser } from "@/services/UserContext";
import { StatusIndicatorData } from "@/components/Experiment/TabbedPage/ExperimentStatusIndicator";

export type ExperimentData = Pick<
  ExperimentInterfaceStringDates,
  | "type"
  | "variations"
  | "status"
  | "archived"
  | "results"
  | "analysisSummary"
  | "phases"
  | "dismissedWarnings"
  | "goalMetrics"
  | "guardrailMetrics"
>;

export function useExperimentStatusIndicator() {
  const { hasCommercialFeature } = useUser();
  const settings = useOrgSettings();
  const healthSettings = {
    decisionFrameworkEnabled:
      (settings.decisionFrameworkEnabled ??
        DEFAULT_DECISION_FRAMEWORK_ENABLED) &&
      hasCommercialFeature("decision-framework"),
    experimentMinLengthDays:
      settings.experimentMinLengthDays ?? DEFAULT_EXPERIMENT_MIN_LENGTH_DAYS,
    experimentMaxLengthDays:
      settings.experimentMaxLengthDays ?? DEFAULT_EXPERIMENT_MAX_LENGTH_DAYS,
    srmThreshold: settings.srmThreshold ?? DEFAULT_SRM_THRESHOLD,
    multipleExposureMinPercent:
      settings.multipleExposureMinPercent ??
      DEFAULT_MULTIPLE_EXPOSURES_THRESHOLD,
  };

  return (experimentData: ExperimentData, skipArchived: boolean = false) =>
    getStatusIndicatorData(experimentData, skipArchived, healthSettings);
}

function getStatusIndicatorData(
  experimentData: ExperimentData,
  skipArchived: boolean,
  healthSettings: {
    decisionFrameworkEnabled: boolean;
    srmThreshold: number;
    multipleExposureMinPercent: number;
    experimentMinLengthDays: number;
  }
): StatusIndicatorData {
  if (!skipArchived && experimentData.archived) {
    return {
      color: "gold",
      variant: "soft",
      status: "Archived",
    };
  }

  if (experimentData.status === "draft") {
    return {
      color: "indigo",
      variant: "soft",
      status: "Draft",
    };
  }

  if (experimentData.status == "running") {
    const unhealthyStatuses: string[] = [];
    const healthSummary = experimentData.analysisSummary?.health;
    const resultsStatus = experimentData.analysisSummary?.resultsStatus;

    const lastPhase = experimentData.phases[experimentData.phases.length - 1];

    const beforeMinDuration =
      lastPhase?.dateStarted &&
      daysBetween(lastPhase.dateStarted, new Date()) <
        healthSettings.experimentMinLengthDays;

    const isLowPowered =
      healthSummary?.power?.type === "success"
        ? healthSummary.power.isLowPowered
        : undefined;
    const daysNeeded =
      healthSummary?.power?.type === "success"
        ? healthSummary.power.additionalDaysNeeded
        : undefined;

    const decisionStatus = resultsStatus
      ? getDetailedStatusIndicatorData(
          getDecisionFrameworkStatus({
            resultsStatus,
            goalMetrics: experimentData.goalMetrics,
            guardrailMetrics: experimentData.guardrailMetrics,
            daysNeeded,
          })
        )
      : undefined;

    const daysLeftStatus = daysNeeded
      ? getDetailedStatusIndicatorData(getDaysLeftStatus({ daysNeeded }))
      : undefined;

    if (healthSummary) {
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
        unhealthyStatuses.push("SRM");
      }

      const multipleExposuresHealthData = getMultipleExposureHealthData({
        multipleExposuresCount: healthSummary.multipleExposures,
        totalUsersCount: healthSummary.totalUsers,
        minCountThreshold: DEFAULT_MULTIPLE_EXPOSURES_ENOUGH_DATA_THRESHOLD,
        minPercentThreshold: healthSettings.multipleExposureMinPercent,
      });

      if (multipleExposuresHealthData.status === "unhealthy") {
        unhealthyStatuses.push("Multiple exposures");
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
        unhealthyStatuses.push("Low powered");
      }
    }

    // 1. Always show unhealthy status if they exist
    if (unhealthyStatuses.length > 0) {
      return {
        color: "amber",
        variant: "solid",
        status: "Running",
        detailedStatus: "Unhealthy",
        tooltip: unhealthyStatuses.join(", "),
      };
    }

    // 2. Show no data if no data is present
    if (healthSummary?.totalUsers === 0) {
      return {
        color: "indigo",
        variant: "solid",
        status: "Running",
        detailedStatus: "No data",
      };
    }

    // 3. If early in the experiment, just say running with a tooltip
    if (beforeMinDuration) {
      return {
        color: "indigo",
        variant: "solid",
        status: "Running",
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

    // 6. Otherwise, show running status
    return {
      color: "indigo",
      variant: "solid",
      status: "Running",
    };
  }

  if (experimentData.status === "stopped") {
    switch (experimentData.results) {
      case "won":
        return {
          color: "gray",
          variant: "soft",
          status: "Stopped",
          detailedStatus: "Won",
        };
      case "lost":
        return {
          color: "gray",
          variant: "soft",
          status: "Stopped",
          detailedStatus: "Lost",
        };
      case "inconclusive":
        return {
          color: "gray",
          variant: "soft",
          status: "Stopped",
          detailedStatus: "Inconclusive",
        };
      case "dnf":
        return {
          color: "gray",
          variant: "soft",
          status: "Stopped",
          detailedStatus: "Didn't finish",
        };
      default:
        return {
          color: "gray",
          variant: "soft",
          status: "Stopped",
          detailedStatus: "Awaiting decision",
        };
    }
  }

  // TODO: Future statuses
  // return ["indigo", "soft", "Scheduled"];

  // FIXME: How can we make this rely on the typechecker instead of throwing an error?
  throw new Error(`Unknown experiment status`);
}

function getDetailedStatusIndicatorData(
  decisionData: DecisionFrameworkData | undefined
): StatusIndicatorData | undefined {
  if (decisionData === undefined) return;

  if (decisionData.status === "rollback-now") {
    return {
      color: "red",
      variant: "solid",
      status: "Running",
      detailedStatus: "Roll Back Now",
      tooltip: decisionData.tooltip,
    };
  }

  if (decisionData.status === "ship-now") {
    return {
      color: "green",
      variant: "solid",
      status: "Running",
      detailedStatus: "Ship Now",
      tooltip: decisionData.tooltip,
    };
  }

  if (decisionData.status === "days-left") {
    const cappedPowerAdditionalDaysNeeded = Math.min(decisionData.daysLeft, 90);
    return {
      color: "indigo",
      variant: "solid",
      status: "Running",
      detailedStatus: `${
        decisionData.daysLeft !== cappedPowerAdditionalDaysNeeded ? ">" : ""
      }${cappedPowerAdditionalDaysNeeded} days left`,
      tooltip: decisionData.tooltip
        ? decisionData.tooltip
        : `The experiment needs more data to reliably detect the target minimum detectable effect for all goal metrics. At recent traffic levels, the experiment will take ~${decisionData.daysLeft} more days to collect enough data.`,
    };
  }

  if (decisionData.status === "ready-for-review") {
    return {
      color: "amber",
      variant: "soft",
      status: "Running",
      detailedStatus: "Ready for Review",
      tooltip: decisionData.tooltip,
    };
  }
}

function getDaysLeftStatus({
  daysNeeded,
}: {
  daysNeeded: number;
}): DecisionFrameworkData | undefined {
  // TODO: Right now midExperimentPowerEnable is controlling the whole "Days Left" status
  // but we should probably split it when considering Experiment Runtime length without power
  if (daysNeeded > 0) {
    return {
      status: "days-left",
      daysLeft: daysNeeded,
    };
  }
}

export function getDecisionFrameworkStatus({
  resultsStatus,
  goalMetrics,
  guardrailMetrics,
  daysNeeded,
}: {
  resultsStatus: ExperimentAnalysisSummaryResultsStatus;
  goalMetrics: string[];
  guardrailMetrics: string[];
  daysNeeded?: number;
}): DecisionFrameworkData | undefined {
  const powerReached = daysNeeded === 0;
  const sequentialTesting = resultsStatus?.settings?.sequentialTesting;

  // Rendering a decision with regular stat sig metrics is only valid
  // if you have reached your needed power or if you used sequential testing
  const decisionReady = powerReached || sequentialTesting;

  let hasWinner = false;
  let hasWinnerWithGuardrailFailure = false;
  let hasSuperStatsigWinner = false;
  let hasSuperStatsigWinnerWithGuardrailFailure = false;
  let nVariationsLosing = 0;
  let nVariationsWithSuperStatSigLoser = 0;
  // if any variation is a clear winner with no guardrail issues, ship now
  for (const variationResult of resultsStatus.variations) {
    const allSuperStatSigWon = goalMetrics.every(
      (m) => variationResult.goalMetrics?.[m]?.superStatSigStatus === "won"
    );
    const anyGuardrailFailure = guardrailMetrics.some(
      (m) => variationResult.guardrailMetrics?.[m]?.status === "lost"
    );

    if (decisionReady) {
      const allStatSigGood = goalMetrics.every(
        (m) => variationResult.goalMetrics?.[m]?.status === "won"
      );
      if (allStatSigGood && !anyGuardrailFailure) {
        hasWinner = true;
      }

      if (allStatSigGood && anyGuardrailFailure) {
        hasWinnerWithGuardrailFailure = true;
      }

      if (
        goalMetrics.every(
          (m) => variationResult.goalMetrics?.[m]?.status === "lost"
        )
      ) {
        nVariationsLosing += 1;
      }
    }

    if (allSuperStatSigWon && !anyGuardrailFailure) {
      hasSuperStatsigWinner = true;
    }

    if (allSuperStatSigWon && anyGuardrailFailure) {
      hasSuperStatsigWinnerWithGuardrailFailure = true;
    }

    if (
      goalMetrics.every(
        (m) => variationResult.goalMetrics?.[m]?.superStatSigStatus === "lost"
      )
    ) {
      nVariationsWithSuperStatSigLoser += 1;
    }
  }

  const tooltipLanguage = powerReached
    ? ` and experiment has reached the target statistical power.`
    : sequentialTesting
    ? ` and sequential testing is enabled, allowing decisions as soon as statistical significance is reached.`
    : ".";

  if (hasWinner) {
    return {
      status: "ship-now",
      tooltip: `All goal metrics are statistically significant in the desired direction for a test variation${tooltipLanguage}`,
    };
  }

  // if no winner without guardrail failure, call out a winner with a guardrail failure
  if (hasWinnerWithGuardrailFailure) {
    return {
      status: "ready-for-review",
      tooltip: `All goal metrics are statistically significant in the desired direction for a test variation ${tooltipLanguage} However, one or more guardrails are failing`,
    };
  }

  // If all variations failing, roll back now
  if (
    nVariationsLosing === resultsStatus.variations.length &&
    nVariationsLosing > 0
  ) {
    return {
      status: "rollback-now",
      tooltip: `All goal metrics are statistically significant in the undesired direction ${tooltipLanguage}`,
    };
  }

  // TODO if super stat sig enabled
  if (hasSuperStatsigWinner) {
    return {
      status: "ship-now",
      tooltip: `The experiment has not yet reached the target statistical power, however, the goal metrics have clear, statistically significant lifts in the desired direction.`,
    };
  }

  // if no winner without guardrail failure, call out a winner with a guardrail failure
  if (hasSuperStatsigWinnerWithGuardrailFailure) {
    return {
      status: "ready-for-review",
      tooltip: `All goal metrics have clear, statistically significant lifts in the desired direction for a test variation. However, one or more guardrails are failing`,
    };
  }

  if (
    nVariationsWithSuperStatSigLoser === resultsStatus.variations.length &&
    nVariationsWithSuperStatSigLoser > 0
  ) {
    return {
      status: "rollback-now",
      tooltip: `The experiment has not yet reached the target statistical power, however, the goal metrics have clear, statistically significant lifts in the undesired direction.`,
    };
  }

  if (powerReached) {
    return {
      status: "ready-for-review",
      tooltip: `The experiment has reached the target statistical power, but does not have conclusive results.`,
    };
  }
}
