import { useEffect, useMemo } from "react";
import { getMultipleExposureHealthData } from "shared/health";
import {
  DEFAULT_MULTIPLE_EXPOSURES_ENOUGH_DATA_THRESHOLD,
  DEFAULT_MULTIPLE_EXPOSURES_THRESHOLD,
} from "shared/constants";
import { SafeRolloutSnapshotInterface } from "shared/types/safe-rollout";
import { ExperimentSnapshotInterface } from "shared/types/experiment-snapshot";
import useOrgSettings from "@/hooks/useOrgSettings";
import Callout from "@/ui/Callout";
import { StatusBadge } from "./StatusBadge";
import { IssueValue } from "./IssueTags";

interface Props {
  totalUsers: number;
  onNotify?: (issue: IssueValue) => void;
  snapshot: ExperimentSnapshotInterface | SafeRolloutSnapshotInterface;
}

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});
const numberFormatter = new Intl.NumberFormat();

export default function MultipleExposuresCard({
  totalUsers,
  onNotify,
  snapshot,
}: Props) {
  const settings = useOrgSettings();

  const minPercentThreshold =
    settings?.multipleExposureMinPercent ??
    DEFAULT_MULTIPLE_EXPOSURES_THRESHOLD;

  const health = useMemo(
    () =>
      getMultipleExposureHealthData({
        multipleExposuresCount: snapshot?.multipleExposures ?? 0,
        totalUsersCount: totalUsers,
        minCountThreshold: DEFAULT_MULTIPLE_EXPOSURES_ENOUGH_DATA_THRESHOLD,
        minPercentThreshold,
      }),
    [snapshot?.multipleExposures, totalUsers, minPercentThreshold],
  );

  useEffect(() => {
    if (health.status === "unhealthy" && onNotify) {
      onNotify({ label: "Multiple Exposures", value: "multipleExposures" });
    }
  }, [snapshot, health, onNotify]);

  if (!snapshot || health.status === "not-enough-traffic") {
    return null;
  }

  const { multipleExposures } = snapshot;

  return (
    <div className="appbox p-3">
      <h2 className="d-inline">Multiple Exposures Check</h2>{" "}
      {health.status !== "healthy" && <StatusBadge status={health.status} />}
      <p className="mt-1">
        Detects whether units have been exposed to multiple variations
      </p>
      <hr></hr>
      <div className="row justify-content-start">
        <div className="ml-2 mr-2 mt-1 w-100">
          {health.status === "healthy" ? (
            <Callout status="info" contentsAs="div">
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
            <Callout status="warning" contentsAs="div">
              <strong>Multiple Exposures Warning</strong>.{" "}
              {numberFormatter.format(multipleExposures)} users (
              {percentFormatter.format(health.rawDecimal)}) saw multiple
              variations and were automatically removed from results. Check for
              bugs in your implementation, event tracking, or data pipeline.
            </Callout>
          )}
        </div>
      </div>
    </div>
  );
}
