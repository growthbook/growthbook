import { useEffect } from "react";
import useOrgSettings from "@front-end/hooks/useOrgSettings";
import { MINIMUM_MULTIPLE_EXPOSURES } from "@front-end/components/Experiment/MultipleExposureWarning";
import { useSnapshot } from "@front-end/components/Experiment/SnapshotProvider";
import { HealthStatus, StatusBadge } from "./StatusBadge";
import { IssueValue } from "./IssueTags";

interface Props {
  totalUsers: number;
  onNotify: (issue: IssueValue) => void;
}

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});
const numberFormatter = new Intl.NumberFormat();

const multiExposureCheck = ({
  multipleExposures,
  minMultipleExposures,
  totalUsers,
  minPercent,
}): HealthStatus => {
  if (multipleExposures < minMultipleExposures) return "healthy";

  const percent = multipleExposures / (multipleExposures + totalUsers);

  if (percent < minPercent) {
    return "healthy";
  }

  return "Issues detected";
};

export default function MultipleExposuresDrawer({
  totalUsers,
  onNotify,
}: Props) {
  const settings = useOrgSettings();
  const { snapshot } = useSnapshot();

  const MIN_PERCENT = settings?.multipleExposureMinPercent ?? 0.01;
  const health = multiExposureCheck({
    multipleExposures: snapshot?.multipleExposures,
    minMultipleExposures: MINIMUM_MULTIPLE_EXPOSURES,
    totalUsers,
    minPercent: MIN_PERCENT,
  });
  useEffect(() => {
    if (health === "Issues detected") {
      onNotify({ label: "Multiple Exposures", value: "multipleExposures" });
    }
  }, [snapshot, health, onNotify]);

  if (!snapshot) return null;

  const { multipleExposures } = snapshot;

  return (
    <div className="appbox p-3">
      <h2 className="d-inline">Multiple Exposures Check</h2>{" "}
      {/* <p className="d-inline text-muted">{helpText}</p> */}
      {health && health !== "healthy" && <StatusBadge status={health} />}
      <p className="mt-1">
        Detects whether units have been exposed to multiple variations
      </p>
      <hr></hr>
      <div className="row justify-content-start">
        <div className="ml-2 mr-2 mt-1 w-100">
          {health === "healthy" ? (
            <div className="alert alert-info">
              {multipleExposures === 0 ? (
                <b>Multiple exposures were not detected.</b>
              ) : (
                `${numberFormatter.format(
                  multipleExposures
                )} multiple exposures detected, but that is below your threshold of ${percentFormatter.format(
                  MIN_PERCENT
                )}`
              )}
            </div>
          ) : (
            <div className="alert alert-warning mb-0">
              <strong>Multiple Exposures Warning</strong>.{" "}
              {numberFormatter.format(multipleExposures)} users (
              {percentFormatter.format(
                multipleExposures / (multipleExposures + totalUsers)
              )}
              ) saw multiple variations and were automatically removed from
              results. Check for bugs in your implementation, event tracking, or
              data pipeline.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
