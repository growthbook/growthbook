import { ReactNode, useEffect, useMemo } from "react";
import { Separator } from "@radix-ui/themes";
import { getClusterIssueHealthData } from "shared/health";
import { DEFAULT_CLUSTER_ISSUE_THRESHOLD } from "shared/constants";
import useOrgSettings from "@/hooks/useOrgSettings";
import Callout from "@/ui/Callout";
import { StatusBadge, StatusBadgeHealth } from "./StatusBadge";
import { IssueValue } from "./IssueTags";

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

// Same layout as MultipleExposuresCard.
function CardFrame({
  title,
  description,
  status,
  children,
}: {
  title: string;
  description: ReactNode;
  status: StatusBadgeHealth;
  children: ReactNode;
}) {
  return (
    <div className="appbox p-3">
      <h2 className="d-inline">{title}</h2>{" "}
      {status !== "healthy" && <StatusBadge status={status} />}
      <p className="mt-1">{description}</p>
      <Separator size="4" my="3" />
      <div className="row justify-content-start">
        <div className="ml-2 mr-2 mt-1 w-100">{children}</div>
      </div>
    </div>
  );
}

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
  belowThresholdMessage: (threshold: string) => ReactNode;
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
      <CardFrame title={title} description={description} status="healthy">
        <Callout status="error">Unable to run this check: {error}</Callout>
      </CardFrame>
    );
  }

  if (health.status === "not-enough-traffic") {
    return null;
  }

  return (
    <CardFrame title={title} description={description} status={health.status}>
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
              )}
        </Callout>
      )}
    </CardFrame>
  );
}
