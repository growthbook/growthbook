import { Tooltip } from "@radix-ui/themes";
import { getMultipleExposureHealthData } from "shared/health";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import Badge from "@/components/Radix/Badge";

type LabelFormat = "full" | "status-only" | "detail-only";

type ExperimentData = Pick<
  ExperimentInterfaceStringDates,
  "status" | "archived" | "results" | "analysisSummary"
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
  const [
    color,
    variant,
    status,
    detailedStatus,
    tooltip,
  ] = getStatusIndicatorData(experimentData, skipArchived);

  const label = getFormattedLabel(labelFormat, status, detailedStatus);

  const badge = (
    <Badge color={color} variant={variant} radius="full" label={label} />
  );

  return tooltip ? <Tooltip content={tooltip}>{badge}</Tooltip> : badge;
}

function getStatusIndicatorData(
  experimentData: ExperimentData,
  skipArchived: boolean
): [
  React.ComponentProps<typeof Badge>["color"],
  React.ComponentProps<typeof Badge>["variant"],
  string, // status
  string?, // detailedStatus
  string? // tooltip
] {
  if (!skipArchived && experimentData.archived) {
    return ["gold", "soft", "Archived"];
  }

  if (experimentData.status === "draft") {
    return ["indigo", "soft", "Draft"];
  }

  const experimentSRM = experimentData.analysisSummary?.health?.srm;
  if (experimentSRM) {
    // FIXME: Use SRM health check
    const srmHealthData = experimentSRM < 0.001 ? "unhealthy" : "healthy";
    if (srmHealthData === "unhealthy") {
      return ["amber", "solid", "Unhealthy", undefined, "SRM"];
    }
  }

  const multipleExposuresHealthData = getMultipleExposureHealthData({
    multipleExposureCount:
      experimentData.analysisSummary?.health?.multipleExposures
        ?.usersWithMultipleExposures || 0,
    totalUnitCount:
      experimentData.analysisSummary?.health?.multipleExposures?.totalUsers ||
      0,
  });

  if (multipleExposuresHealthData.status === "unhealthy") {
    return [
      "amber",
      "solid",
      "Unhealthy",
      undefined,
      "Multiple exposures detected",
    ];
  }

  if (experimentData.status == "running") {
    return ["indigo", "solid", "Running"];

    // TODO: Add detail statuses
    // return ["indigo", "solid", "Running", "~5 days left"];
    // return ["amber", "solid", "Running", "Unhealthy"];
    // return ["amber", "soft", "Running", "Rollback now"];
    // return ["amber", "soft", "Running", "Ship now"];
    // return ["amber", "soft", "Running", "Discuss results"];
  }

  if (experimentData.status === "stopped") {
    switch (experimentData.results) {
      case "won":
        return ["gray", "soft", "Stopped", "Won"];
      case "lost":
        return ["gray", "soft", "Stopped", "Lost"];
      case "inconclusive":
        return ["gray", "soft", "Stopped", "Inconclusive"];
      case "dnf":
        return ["gray", "soft", "Stopped", "Didn't finish"];
      default:
        return ["gray", "soft", "Stopped", "Awaiting decision"];
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
