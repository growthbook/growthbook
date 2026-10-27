import { Flex } from "@radix-ui/themes";
import {
  ExperimentInterfaceStringDates,
  ExperimentResultStatusData,
} from "shared/types/experiment";
import { DEFAULT_SRM_THRESHOLD } from "shared/constants";
import { useRunningExperimentStatus } from "@/hooks/useExperimentStatusIndicator";
import { useUser } from "@/services/UserContext";
import { pValueFormatter } from "@/services/experiments";
import Badge from "@/ui/Badge";
import Metadata from "@/ui/Metadata";
import Tooltip from "@/ui/Tooltip";

type Issue = { label: string; color: "red" | "amber"; detail: string };

const count = new Intl.NumberFormat();
const percent = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 1,
});

// The same checks the experiments list reports as Unhealthy or No data.
export function getHealthIssues(
  result: ExperimentResultStatusData | undefined,
  srmThreshold: number,
): Issue[] {
  const issues: Issue[] = [];
  if (result?.status === "unhealthy") {
    const { srm, multipleExposures, lowPowered, covariateImbalance } =
      result.unhealthyData;
    if (srm) {
      issues.push({
        label: "SRM",
        color: "red",
        detail: `Sample ratio mismatch: the p-value is below ${pValueFormatter(srmThreshold)}, so traffic isn't splitting the way the variation weights say it should.`,
      });
    }
    if (multipleExposures) {
      issues.push({
        label: "Multiple exposures",
        color: "red",
        detail: `${count.format(multipleExposures.multipleExposedUsers)} users (${percent.format(multipleExposures.rawDecimal)}) saw more than one variation and were removed from results.`,
      });
    }
    if (covariateImbalance) {
      issues.push({
        label: "Pre-exposure bias",
        color: "red",
        detail: "The variations differed before users were exposed.",
      });
    }
    if (lowPowered) {
      issues.push({
        label: "Low powered",
        color: "amber",
        detail: "Unlikely to detect the target effect in the time planned.",
      });
    }
  } else if (result?.status === "no-data") {
    issues.push({
      label: "No data",
      color: "amber",
      detail: "No users have been counted in the latest results.",
    });
  }
  return issues;
}

export default function ExperimentHealthBadges({
  experiment,
}: {
  experiment: ExperimentInterfaceStringDates;
}) {
  const { getRunningExperimentResultStatus } = useRunningExperimentStatus();
  const { settings } = useUser();
  const issues = getHealthIssues(
    getRunningExperimentResultStatus(experiment),
    settings.srmThreshold ?? DEFAULT_SRM_THRESHOLD,
  );

  if (!issues.length) return null;
  return (
    <Metadata
      size="sm"
      stacked
      label="Health"
      value={
        <Flex gap="1" wrap="wrap">
          {issues.map(({ label, color, detail }) => (
            <Tooltip key={label} content={detail}>
              <Badge label={label} color={color} variant="soft" />
            </Tooltip>
          ))}
        </Flex>
      }
    />
  );
}
