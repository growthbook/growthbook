import { ReactNode, useEffect, useMemo } from "react";
import { getClusterIssueHealthData } from "shared/health";
import { DEFAULT_CLUSTER_ISSUE_THRESHOLD } from "shared/constants";
import useOrgSettings from "@/hooks/useOrgSettings";
import Callout from "@/ui/Callout";
import HealthCard from "./HealthCard";
import { IssueValue } from "./IssueTags";

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

interface Props {
  id: string;
  title: string;
  description: ReactNode;
  affectedCount: number;
  totalCount: number;
  error?: string;
  // Rendered when nothing was removed.
  healthyMessage: ReactNode;
  // Rendered when some were removed but the share is under the threshold.
  belowThresholdMessage: (threshold: string, share: string) => ReactNode;
  warningMessage: (share: string) => ReactNode;
  onNotify?: (issue: IssueValue) => void;
}

export default function ClusterIssueCard({
  id,
  title,
  description,
  affectedCount,
  totalCount,
  error,
  healthyMessage,
  belowThresholdMessage,
  warningMessage,
  onNotify,
}: Props) {
  const settings = useOrgSettings();
  const minPercentThreshold =
    settings?.clusterIssueMinPercent ?? DEFAULT_CLUSTER_ISSUE_THRESHOLD;

  const health = useMemo(
    () =>
      getClusterIssueHealthData({
        affectedCount,
        totalCount,
        minPercentThreshold,
      }),
    [affectedCount, totalCount, minPercentThreshold],
  );

  useEffect(() => {
    if (!error && health.status === "unhealthy" && onNotify) {
      onNotify({ label: title, value: id });
    }
  }, [error, health, onNotify, title, id]);

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
      {health.status === "unhealthy" ? (
        <Callout status="warning">
          {warningMessage(percentFormatter.format(health.rawDecimal))}
        </Callout>
      ) : (
        <Callout status="success">
          {affectedCount === 0
            ? healthyMessage
            : belowThresholdMessage(
                percentFormatter.format(minPercentThreshold),
                percentFormatter.format(health.rawDecimal),
              )}
        </Callout>
      )}
    </HealthCard>
  );
}
