import { Flex } from "@radix-ui/themes";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { useRunningExperimentStatus } from "@/hooks/useExperimentStatusIndicator";
import Badge from "@/ui/Badge";
import Metadata from "@/ui/Metadata";
import Tooltip from "@/ui/Tooltip";

type Issue = { label: string; color: "red" | "amber"; tooltip: string };

const percent = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 1,
});

/**
 * A running experiment's data problems, one badge each: the same checks the
 * experiments list reports as Unhealthy or No data. Nothing when there are
 * none, or when it isn't running.
 */
export default function ExperimentHealthBadges({
  experiment,
}: {
  experiment: ExperimentInterfaceStringDates;
}) {
  const { getRunningExperimentResultStatus } = useRunningExperimentStatus();
  const result = getRunningExperimentResultStatus(experiment);

  const issues: Issue[] = [];
  if (result?.status === "unhealthy") {
    const { srm, multipleExposures, lowPowered, covariateImbalance } =
      result.unhealthyData;
    if (srm) {
      issues.push({
        label: "SRM",
        color: "red",
        tooltip:
          "Sample ratio mismatch: traffic isn't splitting the way the variation weights say it should.",
      });
    }
    if (multipleExposures) {
      issues.push({
        label: "Multiple exposures",
        color: "red",
        tooltip: `${percent.format(multipleExposures.rawDecimal)} of users saw more than one variation.`,
      });
    }
    if (covariateImbalance) {
      issues.push({
        label: "Pre-exposure bias",
        color: "red",
        tooltip: "The variations differed before users were exposed.",
      });
    }
    if (lowPowered) {
      issues.push({
        label: "Low powered",
        color: "amber",
        tooltip: "Unlikely to detect the target effect in the time planned.",
      });
    }
  } else if (result?.status === "no-data") {
    issues.push({
      label: "No data",
      color: "amber",
      tooltip: "No users have been counted in the latest results.",
    });
  }

  if (!issues.length) return null;
  return (
    <Metadata
      size="sm"
      stacked
      label="Health"
      value={
        <Flex gap="1" wrap="wrap">
          {issues.map(({ label, color, tooltip }) => (
            <Tooltip key={label} content={tooltip}>
              <Badge label={label} color={color} variant="soft" />
            </Tooltip>
          ))}
        </Flex>
      }
    />
  );
}
