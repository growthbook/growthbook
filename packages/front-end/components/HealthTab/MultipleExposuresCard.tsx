import { useEffect, useMemo } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
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
  const { t } = useLingui();
  const settings = useOrgSettings();

  const title = isClusterExperiment
    ? t`Subunit Multiple Exposures Check`
    : t`Multiple Exposures Check`;
  const description = isClusterExperiment
    ? t`Detects whether subunits have been exposed to multiple variations`
    : t`Detects whether units have been exposed to multiple variations`;

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
          ? t`Subunit Multiple Exposures`
          : t`Multiple Exposures`,
        value: "multipleExposures",
      });
    }
    // `snapshotId` is intentionally a dependency so a new snapshot re-notifies
    // the parent even when `health` and `onNotify` are unchanged.
  }, [error, health, onNotify, snapshotId, isClusterExperiment, t]);

  if (error) {
    return (
      <HealthCard title={title} description={description} status="healthy">
        <Callout status="error">
          <Trans>Unable to run this check: {error}</Trans>
        </Callout>
      </HealthCard>
    );
  }

  if (health.status === "not-enough-traffic") {
    return null;
  }

  const exposuresCount = numberFormatter.format(multipleExposures);
  const threshold = percentFormatter.format(minPercentThreshold);
  const share = percentFormatter.format(health.rawDecimal);

  return (
    <HealthCard title={title} description={description} status={health.status}>
      {health.status === "healthy" ? (
        <Callout status="success">
          {multipleExposures === 0
            ? t`Multiple exposures were not detected.`
            : t`${exposuresCount} multiple exposures detected, but that is below your threshold of ${threshold}`}
        </Callout>
      ) : (
        <Callout status="warning">
          {isBandit ? (
            isClusterExperiment ? (
              <Trans>
                {exposuresCount} subunits ({share}) saw multiple variations and
                were left out of the balance check, but remain in results on
                their first exposure.
              </Trans>
            ) : (
              <Trans>
                {exposuresCount} units ({share}) saw multiple variations and
                were left out of the balance check, but remain in results on
                their first exposure.
              </Trans>
            )
          ) : isClusterExperiment ? (
            <Trans>
              {exposuresCount} subunits ({share}) saw multiple variations and
              were automatically removed from results.
            </Trans>
          ) : (
            <Trans>
              {exposuresCount} units ({share}) saw multiple variations and were
              automatically removed from results.
            </Trans>
          )}{" "}
          <Trans>
            Check for bugs in your implementation, event tracking, or data
            pipeline.
          </Trans>
        </Callout>
      )}
    </HealthCard>
  );
}
