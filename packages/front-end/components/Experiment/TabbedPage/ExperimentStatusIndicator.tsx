import { Tooltip } from "@radix-ui/themes";
import {
  ExperimentAnalysisSummaryHealth,
  ExperimentAnalysisSummaryMetricStatus,
} from "back-end/src/validators/experiments";
import {
  DEFAULT_MULTIPLE_EXPOSURES_THRESHOLD,
  DEFAULT_SRM_MINIMINUM_COUNT_PER_VARIATION,
  DEFAULT_SRM_BANDIT_MINIMINUM_COUNT_PER_VARIATION,
  DEFAULT_SRM_THRESHOLD,
  DEFAULT_EXPERIMENT_MIN_LENGTH_DAYS,
  DEFAULT_EXPERIMENT_MAX_LENGTH_DAYS,
  DEFAULT_MID_EXPERIMENT_POWER_CALCULATION_ENABLED,
  DEFAULT_MULTIPLE_EXPOSURES_ENOUGH_DATA_THRESHOLD,
} from "shared/constants";
import { daysBetween } from "shared/dates";
import { getMultipleExposureHealthData, getSRMHealthData } from "shared/health";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import Badge from "@/components/Radix/Badge";
import useOrgSettings from "@/hooks/useOrgSettings";

type LabelFormat = "full" | "status-only" | "detail-only";

type ExperimentData = Pick<
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

type StatusIndicatorData = {
  color: React.ComponentProps<typeof Badge>["color"];
  variant: React.ComponentProps<typeof Badge>["variant"];
  status: string;
  detailedStatus?: string;
  tooltip?: string;
};

/**
 * Component that displays the status of an experiment with an appropriate badge
 *
 * @param experimentData - Experiment data containing status, archived flag, results and analysis summary
 * @param labelFormat - Controls what parts of the status label to show:
 *                     - "full": Shows both status and detail (e.g. "Running - 5 days left")
 *                     - "status-only": Shows just the status (e.g. "Running")
 *                     - "detail-only": Shows just the detail if available (e.g. "5 days left")
 * @param skipArchived - If true, shows the underlying experiment status even if archived
 * @returns A Badge component with appropriate color, variant and label based on experiment state
 */
export default function ExperimentStatusIndicator({
  experimentData,
  labelFormat = "full",
  skipArchived = false,
}: {
  experimentData: ExperimentData;
  labelFormat?: LabelFormat;
  skipArchived?: boolean;
}) {
  const settings = useOrgSettings();
  const healthSettings = {
    midExperimentPowerEnabled:
      settings.midExperimentPowerEnabled ??
      DEFAULT_MID_EXPERIMENT_POWER_CALCULATION_ENABLED,
    experimentMinLengthDays:
      settings.experimentMinLengthDays ?? DEFAULT_EXPERIMENT_MIN_LENGTH_DAYS,
    experimentMaxLengthDays:
      settings.experimentMaxLengthDays ?? DEFAULT_EXPERIMENT_MAX_LENGTH_DAYS,
    srmThreshold: settings.srmThreshold ?? DEFAULT_SRM_THRESHOLD,
    multipleExposureMinPercent:
      settings.multipleExposureMinPercent ??
      DEFAULT_MULTIPLE_EXPOSURES_THRESHOLD,
  };

  const {
    color,
    variant,
    status,
    detailedStatus,
    tooltip,
  } = getStatusIndicatorData(experimentData, skipArchived, healthSettings);

  const label = getFormattedLabel(labelFormat, status, detailedStatus);

  const badge = (
    <Badge
      color={color}
      variant={variant}
      radius="full"
      label={label}
      style={{
        cursor: tooltip !== undefined ? "default" : undefined,
      }}
    />
  );

  return tooltip ? <Tooltip content={tooltip}>{badge}</Tooltip> : badge;
}

function getStatusIndicatorData(
  experimentData: ExperimentData,
  skipArchived: boolean,
  healthSettings: {
    midExperimentPowerEnabled: boolean;
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
    const metricStatus = experimentData.analysisSummary?.metricStatus;

    const lastPhase = experimentData.phases[experimentData.phases.length - 1];

    // skip all statuses
    const beforeMinDuration =
      lastPhase.dateStarted &&
      daysBetween(lastPhase.dateStarted, new Date()) <
        healthSettings.experimentMinLengthDays;

    let powerStatus: PowerStatus | undefined = undefined;
    let shippingIndicatorData: StatusIndicatorData | null = null;
    let powerIndicatorData: StatusIndicatorData | null = null;
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

      if (healthSettings.midExperimentPowerEnabled) {
        powerStatus = getPowerStatus({
          power: healthSummary.power,
        });

        if (
          powerStatus?.isLowPowered &&
          !experimentData.dismissedWarnings?.includes("low-power") &&
          !beforeMinDuration
        ) {
          unhealthyStatuses.push("Low powered");
          // If we have a override status from powerStatus, use it
        } else if (powerStatus?.indicatorData) {
          powerIndicatorData = powerStatus.indicatorData;
        }
      }

      if (metricStatus) {
        shippingIndicatorData = getShippingStatus({
          metricStatus,
          goalMetrics: experimentData.goalMetrics,
          guardrailMetrics: experimentData.guardrailMetrics,
          powerStatus: powerStatus,
        });
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

    // 4. if clear shipping status, show it
    if (shippingIndicatorData) {
      return shippingIndicatorData;
    }

    // 5. If no unhealthy status or clear shipping criteria, show days left data
    if (powerIndicatorData) {
      return powerIndicatorData;
    }

    // 5. Otherwise, show running status
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

function getFormattedLabel(
  labelFormat: LabelFormat,
  status: string,
  detailedStatus?: string
): string {
  switch (labelFormat) {
    case "full":
      if (detailedStatus) {
        return `${status}: ${detailedStatus}`;
      } else {
        return status;
      }

    case "detail-only":
      if (detailedStatus) {
        return detailedStatus;
      } else {
        return status;
      }

    case "status-only":
      return status;

    default: {
      const _exhaustiveCheck: never = labelFormat;
      throw new Error(`Unknown label format: ${_exhaustiveCheck}`);
    }
  }
}

// TODO rename just to days left
type PowerStatus = {
  isLowPowered: boolean;
  additionalDaysNeeded: number;
  indicatorData?: StatusIndicatorData;
};
function getPowerStatus({
  power,
}: {
  power: ExperimentAnalysisSummaryHealth["power"];
}): PowerStatus | undefined {
  // TODO: Right now midExperimentPowerEnable is controlling the whole "Days Left" status
  // but we should probably split it when considering Experiment Runtime length without power

  const isLowPowered = power?.type === "success" && power.isLowPowered;

  const powerAdditionalDaysNeeded =
    power?.type === "success" ? power.additionalDaysNeeded : undefined;
  if (powerAdditionalDaysNeeded === undefined) {
    return;
  }

  if (powerAdditionalDaysNeeded > 0) {
    const cappedPowerAdditionalDaysNeeded = Math.min(
      powerAdditionalDaysNeeded,
      90
    );

    return {
      isLowPowered,
      additionalDaysNeeded: powerAdditionalDaysNeeded,
      indicatorData: {
        color: "indigo",
        variant: "solid",
        status: "Running",
        detailedStatus: `${
          powerAdditionalDaysNeeded !== cappedPowerAdditionalDaysNeeded
            ? ">"
            : ""
        }${cappedPowerAdditionalDaysNeeded} days left`,
        tooltip: `This experiment has not collected enough data to reliably detected the specified Target MDE for all goal metrics. At recent traffic levels, the experiment will take ~${powerAdditionalDaysNeeded} days to collect enough data.`,
      },
    };
  }
  return { isLowPowered, additionalDaysNeeded: powerAdditionalDaysNeeded };
}

function getShippingStatus({
  metricStatus,
  goalMetrics,
  guardrailMetrics,
  powerStatus,
}: {
  metricStatus: ExperimentAnalysisSummaryMetricStatus;
  goalMetrics: string[];
  guardrailMetrics: string[];
  powerStatus?: PowerStatus;
}): StatusIndicatorData | null {
  const powerReached = powerStatus?.additionalDaysNeeded === 0;
  const decisionReady = powerReached || metricStatus.sequentialUsed;

  let hasWinner = false;
  let hasWinnerWithGuardrailFailure = false;
  let hasSuperStatsigWinner = false;
  let nVariationsLosing = 0;
  let nVariationsWithSuperStatSigLoser = 0;
  // if any variation is a clear winner with no guardrail issues, ship now
  for (const variationResult of metricStatus.variations) {
    const allSuperStatSigPositive = goalMetrics.every((m) =>
      variationResult.goalMetricsSuperStatSigPositive.includes(m)
    );
    const guardrailFailure = guardrailMetrics.some((m) =>
      variationResult.guardrailMetricsFailing.includes(m)
    );

    if (decisionReady) {
      const allStatSigPositive = goalMetrics.every((m) =>
        variationResult.goalMetricsStatSigPositive.includes(m)
      );
      if (allStatSigPositive && !guardrailFailure) {
        hasWinner = true;
      }

      if (allStatSigPositive && guardrailFailure) {
        hasWinnerWithGuardrailFailure = true;
      }

      if (
        goalMetrics.every((m) =>
          variationResult.goalMetricsStatSigNegative.includes(m)
        )
      ) {
        nVariationsLosing += 1;
      }
    }

    if (allSuperStatSigPositive && !guardrailFailure) {
      hasSuperStatsigWinner = true;
    }

    if (
      goalMetrics.every((m) =>
        variationResult.goalMetricsSuperStatSigNegative.includes(m)
      )
    ) {
      nVariationsWithSuperStatSigLoser += 1;
    }
  }

  const tooltipLanguage =
    powerStatus?.additionalDaysNeeded === 0
      ? `Experiment has reached the target statistical power and`
      : metricStatus.sequentialUsed
      ? `Sequential testing enables calling an experiment as soon as it is significant and`
      : "";

  if (hasWinner) {
    return {
      color: "green",
      variant: "solid",
      status: "Running",
      detailedStatus: "Ship Now",
      tooltip: `${tooltipLanguage} all goal metrics are statistically significant in the desired direction for a test variation.`,
    };
  }

  // if no winner without guardrail failure, call out a winner with a guardrail failure
  if (hasWinnerWithGuardrailFailure) {
    return {
      color: "amber",
      variant: "solid",
      status: "Running",
      detailedStatus: "Ready for Review",
      tooltip: `${tooltipLanguage} all goal metrics are statistically significant in the desired direction for a test variation. However, one or more guardrails are failing`,
    };
  }

  // If all variations failing, roll back now
  if (
    nVariationsLosing === metricStatus.variations.length &&
    nVariationsLosing > 0
  ) {
    return {
      color: "red",
      variant: "solid",
      status: "Running",
      detailedStatus: "Roll Back Now",
      tooltip: `${tooltipLanguage} all goal metrics are statistically significant in the undesired direction.`,
    };
  }

  // TODO if super stat sig enabled
  if (hasSuperStatsigWinner) {
    return {
      color: "green",
      variant: "solid",
      status: "Running",
      detailedStatus: "Ship Now",
      tooltip: `The experiment has not yet reached the target statistical power, however, the goal metrics have clear, statistically significant lifts in the desired direction.`,
    };
  }

  if (
    nVariationsWithSuperStatSigLoser === metricStatus.variations.length &&
    nVariationsWithSuperStatSigLoser > 0
  ) {
    return {
      color: "red",
      variant: "solid",
      status: "Running",
      detailedStatus: "Roll Back Now",
      tooltip: `The experiment has not yet reached the target statistical power, however, the goal metrics have clear, statistically significant lifts in the undesired direction.`,
    };
  }

  if (powerReached) {
    return {
      color: "amber",
      variant: "solid",
      status: "Running",
      detailedStatus: "Ready for Review",
      tooltip: `The experiment has reached the target statistical power, but does not have conclusive results.`,
    };
  }

  return null;
}
