import {
  getHealthSettings,
  getExperimentResultStatus,
  DEFAULT_DECISION_CRITERIA,
  DEFAULT_DECISION_CRITERIAS,
} from "shared/enterprise";
import {
  ExperimentHealthSettings,
  ExperimentDataForStatusStringDates,
  ExperimentResultStatusData,
  DecisionCriteriaData,
  DecisionCriteriaInterface,
} from "back-end/types/experiment";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useUser } from "@/services/UserContext";
import useApi from "@/hooks/useApi";

export type StatusIndicatorData = {
  color: "amber" | "green" | "red" | "gold" | "indigo" | "gray" | "pink";
  status: "Running" | "Stopped" | "Draft" | "Archived";
  detailedStatus?: string;
  needsAttention?: boolean;
  tooltip?: string;
  // Most actionable status have higher numbers
  sortOrder: number;
};

export function useExperimentStatusIndicator() {
  const { hasCommercialFeature } = useUser();
  const settings = useOrgSettings();
  const healthSettings = getHealthSettings(
    settings,
    hasCommercialFeature("decision-framework")
  );

  const decisionCriteria = !settings?.defaultDecisionCriteriaId
    ? DEFAULT_DECISION_CRITERIA
    : DEFAULT_DECISION_CRITERIAS.find(
        (dc) => dc.id === settings.defaultDecisionCriteriaId
      );
  const { data } = useApi<{ decisionCriteria: DecisionCriteriaInterface }>(
    `/decision-criteria/${settings?.defaultDecisionCriteriaId}`,
    {
      shouldRun: () =>
        !!settings?.defaultDecisionCriteriaId && !decisionCriteria,
    }
  );

  return (
    experimentData: ExperimentDataForStatusStringDates,
    skipArchived: boolean = false
  ) =>
    getStatusIndicatorData(
      experimentData,
      skipArchived,
      healthSettings,
      decisionCriteria ?? data?.decisionCriteria ?? DEFAULT_DECISION_CRITERIA
    );
}

function getDetailedRunningStatusIndicatorData(
  decisionData: ExperimentResultStatusData
): StatusIndicatorData {
  switch (decisionData.status) {
    case "rollback-now":
      return {
        color: "amber",
        status: "Running",
        detailedStatus: "Roll back now",
        tooltip: decisionData.tooltip,
        needsAttention: true,
        sortOrder: 13,
      };
    case "ship-now":
      return {
        color: "amber",
        status: "Running",
        detailedStatus: "Ship now",
        tooltip: decisionData.tooltip,
        needsAttention: true,
        sortOrder: 12,
      };
    case "ready-for-review":
      return {
        color: "amber",
        status: "Running",
        detailedStatus: "Ready for review",
        tooltip: decisionData.tooltip,
        needsAttention: true,
        sortOrder: 11,
      };
    case "no-data":
      return {
        color: "amber",
        status: "Running",
        detailedStatus: "No data",
        tooltip: decisionData.tooltip,
        needsAttention: true,
        sortOrder: 10,
      };
    case "unhealthy":
      return {
        color: "amber",
        status: "Running",
        detailedStatus: "Unhealthy",
        tooltip: decisionData.tooltip,
        needsAttention: true,
        sortOrder: 9,
      };
    case "days-left": {
      const cappedPowerAdditionalDaysNeeded = Math.min(
        decisionData.daysLeft,
        90
      );

      // Fewer days left = higher sortOrder
      const sortOrderDecimal = 1 - cappedPowerAdditionalDaysNeeded / 90;

      return {
        color: "indigo",
        status: "Running",
        detailedStatus: `${
          decisionData.daysLeft !== cappedPowerAdditionalDaysNeeded ? ">" : ""
        }${cappedPowerAdditionalDaysNeeded} days left`,
        tooltip: decisionData.tooltip
          ? decisionData.tooltip
          : `The experiment needs more data to reliably detect the target minimum detectable effect for all goal metrics. At recent traffic levels, the experiment will take ~${decisionData.daysLeft} more days to collect enough data.`,
        sortOrder: 8 + sortOrderDecimal,
      };
    }
    case "before-min-duration":
      return {
        color: "indigo",
        status: "Running",
        tooltip: decisionData.tooltip,
        sortOrder: 7,
      };
  }
}

export function getStatusIndicatorData(
  experimentData: ExperimentDataForStatusStringDates,
  skipArchived: boolean,
  healthSettings: ExperimentHealthSettings,
  decisionCriteria: DecisionCriteriaData
): StatusIndicatorData {
  if (!skipArchived && experimentData.archived) {
    return {
      color: "gold",
      status: "Archived",
      sortOrder: 0,
    };
  }

  if (experimentData.status === "draft") {
    return {
      color: "pink",
      status: "Draft",
      sortOrder: 6,
    };
  }

  if (experimentData.status == "running") {
    const runningStatusData = getExperimentResultStatus({
      experimentData,
      healthSettings,
      decisionCriteria,
    });
    if (runningStatusData) {
      return getDetailedRunningStatusIndicatorData(runningStatusData);
    }

    // 6. Otherwise, show running status
    return {
      color: "indigo",
      status: "Running",
      sortOrder: 7,
    };
  }

  if (experimentData.status === "stopped") {
    switch (experimentData.results) {
      case "won":
        return {
          color: "green",
          status: "Stopped",
          detailedStatus: "Won",
          sortOrder: 4,
        };
      case "lost":
        return {
          color: "red",
          status: "Stopped",
          detailedStatus: "Lost",
          sortOrder: 3,
          tooltip: "There are no real losers in A/B testing, only learnings.",
        };
      case "inconclusive":
        return {
          color: "gray",
          status: "Stopped",
          detailedStatus: "Inconclusive",
          sortOrder: 2,
        };
      case "dnf":
        return {
          color: "gray",
          status: "Stopped",
          detailedStatus: "Didn't finish",
          sortOrder: 1,
        };
      default:
        return {
          color: "amber",
          status: "Stopped",
          detailedStatus: "Awaiting decision",
          needsAttention: true,
          sortOrder: 5,
        };
    }
  }

  // TODO: Future statuses
  // return ["indigo", "soft", "Scheduled"];

  // FIXME: How can we make this rely on the typechecker instead of throwing an error?
  throw new Error(`Unknown experiment status`);
}
