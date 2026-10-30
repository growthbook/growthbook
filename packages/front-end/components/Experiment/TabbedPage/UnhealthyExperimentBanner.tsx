import { Fragment } from "react";
import { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";
import { PiCaretRight } from "react-icons/pi";
import { DEFAULT_SRM_THRESHOLD } from "shared/constants";
import {
  ExperimentInterfaceStringDates,
  ExperimentResultStatusData,
  ExperimentUnhealthyData,
} from "shared/types/experiment";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";
import { useUser } from "@/services/UserContext";
import { pValueFormatter } from "@/services/experiments";

const count = new Intl.NumberFormat();
const percent = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 1,
});

// "1 cluster (4%) ... was removed" / "3 clusters (12%) ... were removed"
const removedFromResults = (
  n: number,
  noun: string,
  rawDecimal: number,
  what: string,
) =>
  `${count.format(n)} ${noun}${n === 1 ? "" : "s"} (${percent.format(rawDecimal)}) ${what} and ${n === 1 ? "was" : "were"} removed from results.`;

function getHealthIssues(
  {
    srm,
    multipleExposures,
    lowPowered,
    covariateImbalance,
    clusterAssignment,
    clusterMapping,
  }: ExperimentUnhealthyData,
  srmThreshold: number,
  isClusterExperiment: boolean,
): { label: string; severe: boolean; detail: string }[] {
  return [
    srm
      ? {
          label: "SRM",
          severe: true,
          detail: `Sample ratio mismatch: the p-value is below ${pValueFormatter(srmThreshold)}, so traffic isn't splitting the way the variation weights say it should.`,
        }
      : null,
    multipleExposures
      ? {
          label: isClusterExperiment
            ? "Sub-unit multiple exposures"
            : "Multiple exposures",
          severe: true,
          detail: removedFromResults(
            multipleExposures.multipleExposedUsers,
            isClusterExperiment ? "sub-unit" : "user",
            multipleExposures.rawDecimal,
            "saw more than one variation",
          ),
        }
      : null,
    covariateImbalance
      ? {
          label: "Pre-exposure bias",
          severe: true,
          detail: "The variations differed before users were exposed.",
        }
      : null,
    clusterAssignment
      ? {
          label: "Mixed cluster assignment",
          severe: true,
          detail: removedFromResults(
            clusterAssignment.mixedClusters,
            "cluster",
            clusterAssignment.rawDecimal,
            "had units in more than one variation",
          ),
        }
      : null,
    clusterMapping
      ? {
          label: "Units in multiple clusters",
          severe: true,
          detail: removedFromResults(
            clusterMapping.multiClusterUnits,
            "unit",
            clusterMapping.rawDecimal,
            "appeared in more than one cluster",
          ),
        }
      : null,
    lowPowered
      ? {
          label: "Low powered",
          severe: false,
          detail: "Unlikely to detect the target effect in the time planned.",
        }
      : null,
  ].filter((issue) => issue !== null);
}

// Stands in for the results' own health warnings while it shows.
export function showsUnhealthyBanner(
  experiment: ExperimentInterfaceStringDates,
  status: ExperimentResultStatusData | undefined,
) {
  return (
    experiment.status === "running" &&
    experiment.type !== "holdout" &&
    status?.status === "unhealthy"
  );
}

type Props = {
  status: ExperimentResultStatusData;
  viewHealth: (() => void) | null;
  isClusterExperiment?: boolean;
} & MarginProps;

export default function UnhealthyExperimentBanner({
  status,
  viewHealth,
  isClusterExperiment = false,
  ...margin
}: Props) {
  const { settings } = useUser();
  if (status.status !== "unhealthy") return null;
  const issues = getHealthIssues(
    status.unhealthyData,
    settings.srmThreshold ?? DEFAULT_SRM_THRESHOLD,
    isClusterExperiment,
  );
  const severe = issues.some((issue) => issue.severe);

  return (
    <Callout
      status="warning"
      contentAlign="center"
      action={
        viewHealth ? (
          <Button
            variant="ghost"
            size="sm"
            icon={<PiCaretRight />}
            iconPosition="right"
            onClick={viewHealth}
          >
            View health
          </Button>
        ) : null
      }
      {...margin}
    >
      <Text weight="semibold">Unhealthy:</Text>{" "}
      {issues.map(({ label, detail }, i) => (
        <Fragment key={label}>
          {i ? ", " : null}
          <Tooltip content={detail}>
            <span tabIndex={0}>{label}</span>
          </Tooltip>
        </Fragment>
      ))}
      .{" "}
      {severe
        ? "Results are likely untrustworthy."
        : "It's unlikely to detect the target effect in time."}
    </Callout>
  );
}
