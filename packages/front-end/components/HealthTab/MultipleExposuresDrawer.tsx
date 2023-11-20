import { useEffect } from "react";
import useOrgSettings from "@/hooks/useOrgSettings";
import { MINIMUM_MULTIPLE_EXPOSURES } from "../Experiment/MultipleExposureWarning";
import HealthDrawer from "./HealthDrawer";
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

const HEALTHY_TOOLTIP_MESSAGE = "Multiple exposures were not detected.";

const UNHEALTHY_TOOLTIP_MESSAGE = " multiple exposures detected!";

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

  return "unhealthy";
};

const renderTooltipBody = ({
  multipleExposures,
  health,
}: {
  multipleExposures: number;
  health: HealthStatus;
}) => {
  return (
    <div>
      {health === "healthy" && <div>{HEALTHY_TOOLTIP_MESSAGE}</div>}
      {health === "unhealthy" && (
        <div>
          <b>{multipleExposures}</b>
          {UNHEALTHY_TOOLTIP_MESSAGE}
        </div>
      )}
    </div>
  );
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
    if (health === "unhealthy") {
      onNotify();
    }
  }, [health, onNotify]);

  return (
    <HealthDrawer
      title="Multiple Exposures Check"
      status={health}
      tooltipBody={renderTooltipBody({ multipleExposures, health })}
    >
      <div className="row justify-content-start mb-2">
        <div className="ml-2 mt-4">
          {health === "healthy" ? (
            <div className="alert alert-info">
              {multipleExposures === 0
                ? HEALTHY_TOOLTIP_MESSAGE
                : `${numberFormatter.format(
                    multipleExposures
                  )} multiple exposures detected, but that is below your threshold of ${percentFormatter.format(
                    MIN_PERCENT
                  )}`}
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
    </HealthDrawer>
  );
}
