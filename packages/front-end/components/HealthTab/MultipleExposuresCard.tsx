import { useEffect, useMemo } from "react";
import { getMultipleExposureHealthData } from "shared/health";
import {
  DEFAULT_MULTIPLE_EXPOSURES_ENOUGH_DATA_THRESHOLD,
  DEFAULT_MULTIPLE_EXPOSURES_THRESHOLD,
} from "shared/constants";
import useOrgSettings from "@/hooks/useOrgSettings";
import Callout from "@/ui/Callout";
import HealthCard from "./HealthCard";
import { IssueValue } from "./IssueTags";

interface Props {
  totalUsers: number;
  multipleExposures: number;
  onNotify?: (issue: IssueValue) => void;
  snapshotId?: string;
  // Contextual Bandits retain each user's first assignment in decision results
  // (only the balance query drops duplicates within a leaf and period), so the
  // warning must not claim these users were removed from results.
  isBandit?: boolean;
  isClusterExperiment?: boolean;
  error?: string;
}

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});
const numberFormatter = new Intl.NumberFormat();

export default function MultipleExposuresCard({
  totalUsers,
  multipleExposures,
  onNotify,
  snapshotId,
  isBandit = false,
  isClusterExperiment = false,
  error,
}: Props) {
  const settings = useOrgSettings();

  const unitNoun = isClusterExperiment ? "subunits" : "units";
  const title = isClusterExperiment
    ? "Subunit Multiple Exposures Check"
    : "Multiple Exposures Check";
  const description = `Detects whether ${unitNoun} have been exposed to multiple variations`;

  const minPercentThreshold =
    settings?.multipleExposureMinPercent ??
    DEFAULT_MULTIPLE_EXPOSURES_THRESHOLD;

  const health = useMemo(
    () =>
      getMultipleExposureHealthData({
        multipleExposuresCount: multipleExposures,
        totalUsersCount: totalUsers,
        minCountThreshold: DEFAULT_MULTIPLE_EXPOSURES_ENOUGH_DATA_THRESHOLD,
        minPercentThreshold,
      }),
    [multipleExposures, totalUsers, minPercentThreshold],
  );

  useEffect(() => {
    if (!error && health.status === "unhealthy" && onNotify) {
      onNotify({
        label: isClusterExperiment
          ? "Subunit Multiple Exposures"
          : "Multiple Exposures",
        value: "multipleExposures",
      });
    }
    // `snapshotId` is intentionally a dependency so a new snapshot re-notifies
    // the parent even when `health` and `onNotify` are unchanged.
  }, [error, health, onNotify, snapshotId, isClusterExperiment]);

  if (error) {
    return (
      <HealthCard title={title} description={description} status="healthy">
        <Callout status="error">Unable to run this check: {error}</Callout>
      </HealthCard>
    );
  }

  if (health.status === "not-enough-traffic") {
    return null;
  }

  return (
    <HealthCard title={title} description={description} status={health.status}>
      {health.status === "healthy" ? (
        <Callout status="success">
          {multipleExposures === 0 ? (
            <b>Multiple exposures were not detected.</b>
          ) : (
            `${numberFormatter.format(
              multipleExposures,
            )} multiple exposures detected, but that is below your threshold of ${percentFormatter.format(
              minPercentThreshold,
            )}`
          )}
        </Callout>
      ) : (
        <Callout status="warning">
          <strong>
            {isClusterExperiment
              ? "Subunit Multiple Exposures Warning"
              : "Multiple Exposures Warning"}
          </strong>
          . {numberFormatter.format(multipleExposures)} {unitNoun} (
          {percentFormatter.format(health.rawDecimal)}) saw multiple variations
          {isBandit
            ? " and were left out of the balance check, but remain in results on their first exposure"
            : " and were automatically removed from results"}
          . Check for bugs in your implementation, event tracking, or data
          pipeline.
        </Callout>
      )}
    </HealthCard>
  );
}
