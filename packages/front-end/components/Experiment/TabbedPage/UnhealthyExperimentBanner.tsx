import { Fragment } from "react";
import { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";
import { PiCaretRight } from "react-icons/pi";
import type { I18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
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
  i18n: I18n,
  n: number,
  noun: "user" | "subunit" | "cluster" | "unit",
  rawDecimal: number,
) => {
  const amount = count.format(n);
  const share = percent.format(rawDecimal);
  const one = n === 1;
  switch (noun) {
    case "user":
      return one
        ? i18n._(
            msg`${amount} user (${share}) saw more than one variation and was removed from results.`,
          )
        : i18n._(
            msg`${amount} users (${share}) saw more than one variation and were removed from results.`,
          );
    case "subunit":
      return one
        ? i18n._(
            msg`${amount} subunit (${share}) saw more than one variation and was removed from results.`,
          )
        : i18n._(
            msg`${amount} subunits (${share}) saw more than one variation and were removed from results.`,
          );
    case "cluster":
      return one
        ? i18n._(
            msg`${amount} cluster (${share}) had units in more than one variation and was removed from results.`,
          )
        : i18n._(
            msg`${amount} clusters (${share}) had units in more than one variation and were removed from results.`,
          );
    case "unit":
      return one
        ? i18n._(
            msg`${amount} unit (${share}) appeared in more than one cluster and was removed from results.`,
          )
        : i18n._(
            msg`${amount} units (${share}) appeared in more than one cluster and were removed from results.`,
          );
  }
};

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
  i18n: I18n,
): { label: string; severe: boolean; detail: string }[] {
  const threshold = pValueFormatter(srmThreshold);
  return [
    srm
      ? {
          label: i18n._(msg`SRM`),
          severe: true,
          detail: i18n._(
            msg`Sample ratio mismatch: the p-value is below ${threshold}, so traffic isn't splitting the way the variation weights say it should.`,
          ),
        }
      : null,
    multipleExposures
      ? {
          label: isClusterExperiment
            ? i18n._(msg`Subunit multiple exposures`)
            : i18n._(msg`Multiple exposures`),
          severe: true,
          detail: removedFromResults(
            i18n,
            multipleExposures.multipleExposedUsers,
            isClusterExperiment ? "subunit" : "user",
            multipleExposures.rawDecimal,
          ),
        }
      : null,
    covariateImbalance
      ? {
          label: i18n._(msg`Pre-exposure bias`),
          severe: true,
          detail: i18n._(
            msg`The variations differed before users were exposed.`,
          ),
        }
      : null,
    clusterAssignment
      ? {
          label: i18n._(msg`Mixed cluster assignment`),
          severe: true,
          detail: removedFromResults(
            i18n,
            clusterAssignment.mixedClusters,
            "cluster",
            clusterAssignment.rawDecimal,
          ),
        }
      : null,
    clusterMapping
      ? {
          label: i18n._(msg`Units in multiple clusters`),
          severe: true,
          detail: removedFromResults(
            i18n,
            clusterMapping.multiClusterUnits,
            "unit",
            clusterMapping.rawDecimal,
          ),
        }
      : null,
    lowPowered
      ? {
          label: i18n._(msg`Low powered`),
          severe: false,
          detail: i18n._(
            msg`Unlikely to detect the target effect in the time planned.`,
          ),
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
  const { i18n } = useLingui();
  const { settings } = useUser();
  if (status.status !== "unhealthy") return null;
  const issues = getHealthIssues(
    status.unhealthyData,
    settings.srmThreshold ?? DEFAULT_SRM_THRESHOLD,
    isClusterExperiment,
    i18n,
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
            <Trans>View health</Trans>
          </Button>
        ) : null
      }
      {...margin}
    >
      <Text weight="semibold">
        <Trans>Unhealthy:</Trans>
      </Text>{" "}
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
        ? i18n._(msg`Results are likely untrustworthy.`)
        : i18n._(msg`It's unlikely to detect the target effect in time.`)}
    </Callout>
  );
}
