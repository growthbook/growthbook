import { Tooltip } from "@radix-ui/themes";
import {
  DEFAULT_MULTIPLE_EXPOSURES_MINIMUM_COUNT,
  DEFAULT_MULTIPLE_EXPOSURES_THRESHOLD,
  DEFAULT_SRM_MINIMINUM_COUNT_PER_VARIATION,
  DEFAULT_SRM_BANDIT_MINIMINUM_COUNT_PER_VARIATION,
  DEFAULT_SRM_THRESHOLD,
  DEFAULT_EXPERIMENT_MIN_LENGTH_DAYS,
  DEFAULT_EXPERIMENT_MAX_LENGTH_DAYS,
  DEFAULT_MID_EXPERIMENT_POWER_CALCULATION_ENABLED,
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
>;

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
    <Badge color={color} variant={variant} radius="full" label={label} />
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
    experimentMaxLengthDays: number;
  }
): {
  color: React.ComponentProps<typeof Badge>["color"];
  variant: React.ComponentProps<typeof Badge>["variant"];
  status: string;
  detailedStatus?: string;
  tooltip?: string;
} {
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

  const lastPhase = experimentData.phases[experimentData.phases.length - 1];
  if (experimentData.status == "running") {
    console.log(healthSettings.midExperimentPowerEnabled);
    if (
      healthSettings.midExperimentPowerEnabled &&
      lastPhase.dateStarted &&
      daysBetween(lastPhase.dateStarted, new Date()) >
        healthSettings.experimentMaxLengthDays
    ) {
      return {
        color: "amber",
        variant: "soft",
        status: "Running",
        detailedStatus: "Discuss results",
        tooltip: "Reached antecipated duration",
      };
    }

    const unhealthyStatuses: string[] = [];
    const healthSummary = experimentData.analysisSummary?.health;
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
        minCountThreshold: DEFAULT_MULTIPLE_EXPOSURES_MINIMUM_COUNT,
        minPercentThreshold: healthSettings.multipleExposureMinPercent,
      });

      if (multipleExposuresHealthData.status === "unhealthy") {
        unhealthyStatuses.push("Multiple exposures");
      }

      const powerSummary = healthSummary.power;
      if (
        powerSummary &&
        powerSummary.type === "success" &&
        powerSummary.isLowPowered
      ) {
        unhealthyStatuses.push("Low powered");
      }

      if (
        powerSummary &&
        powerSummary.type === "success" &&
        !powerSummary.isLowPowered
      ) {
        return {
          color: "indigo",
          variant: "solid",
          status: "Running",
          detailedStatus: `~${powerSummary.additionalDaysNeeded} days left`,
        };
      }
    }

    if (unhealthyStatuses.length > 0) {
      return {
        color: "amber",
        variant: "solid",
        status: "Running",
        detailedStatus: "Unhealthy",
        tooltip: unhealthyStatuses.join(", "),
      };
    }

    return {
      color: "indigo",
      variant: "solid",
      status: "Running",
    };

    // TODO: Add detail statuses
    // return ["indigo", "solid", "Running", "~5 days left"];
    // return ["amber", "soft", "Running", "Rollback now"];
    // return ["amber", "soft", "Running", "Ship now"];
    // return ["amber", "soft", "Running", "Discuss results"];
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
