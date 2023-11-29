import { useEffect } from "react";
import useOrgSettings from "@/hooks/useOrgSettings";
import { MINIMUM_MULTIPLE_EXPOSURES } from "../Experiment/MultipleExposureWarning";
import HealthCard from "./HealthCard";
import { HealthStatus } from "./StatusBadge";

interface Props {
  totalUsers: number;
  multipleExposures: number;
  onNotify: () => void;
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
  multipleExposures,
  onNotify,
}: Props) {
  const settings = useOrgSettings();
  const MIN_PERCENT = settings?.multipleExposureMinPercent ?? 0.01;
  const health = multiExposureCheck({
    multipleExposures,
    minMultipleExposures: MINIMUM_MULTIPLE_EXPOSURES,
    totalUsers,
    minPercent: MIN_PERCENT,
  });
  useEffect(() => {
    if (health === "Issues detected") {
      onNotify();
    }
  }, [health, onNotify]);

  return (
    <HealthCard
      title="Multiple Exposures Check"
      helpText="Detects whether units have been exposed to multiple variations"
      status={health}
    >
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
            <div className="alert alert-warning">
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
    </HealthCard>
  );
}
