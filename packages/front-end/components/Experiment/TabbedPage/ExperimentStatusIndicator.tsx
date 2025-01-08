import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import Badge from "@/components/Radix/Badge";

type LabelFormat = "full" | "status-only" | "detail-only";

type ExperimentData = Pick<
  ExperimentInterfaceStringDates,
  "status" | "archived" | "results" | "analysisSummary"
>;

type Props = {
  experimentData: ExperimentData;
  labelFormat?: LabelFormat;
  skipArchived?: boolean;
};

/**
 * @param experimentData - Data about the experiment's status, archived state, results and analysis
 * @param labelFormat - Controls how the status label is formatted:
 *                     "full" - Shows both status and details (e.g. "Running: ~5 days left")
 *                     "status-only" - Shows just the status (e.g. "Running")
 *                     "detail-only" - Shows just the details (e.g. "~5 days left")
 * @param skipArchived - If true, shows the underlying experiment status even when the experiment is archived
 */
export default function ExperimentStatusIndicator({
  experimentData,
  labelFormat = "full",
  skipArchived = false,
}: Props) {
  const [color, variant, status, detailedStatus] = getBadgeProps(
    experimentData,
    skipArchived
  );

  const label = getFormattedLabel(labelFormat, status, detailedStatus);

  return <Badge color={color} variant={variant} radius="full" label={label} />;
}

function getBadgeProps(
  experimentData: ExperimentData,
  skipArchived: boolean
): [
  React.ComponentProps<typeof Badge>["color"],
  React.ComponentProps<typeof Badge>["variant"],
  string, // formattedStatus
  string? // detailedStatus if applicable
] {
  if (!skipArchived && experimentData.archived) {
    return ["gold", "soft", "Archived"];
  }

  if (experimentData.status === "draft") {
    return ["indigo", "soft", "Draft"];
  }

  if (experimentData.status == "running") {
    if (experimentData.analysisSummary?.health?.power?.errorMessage) {
      return [
        "amber",
        "solid",
        "Unhealthy",
        experimentData.analysisSummary.health.power.errorMessage,
      ];
    }

    if (experimentData.analysisSummary?.health?.power?.lowPowerWarning) {
      return ["amber", "solid", "Unhealthy", "Low powered"];
    }

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
