import {
  DEFAULT_MULTIPLE_EXPOSURES_THRESHOLD,
  DEFAULT_MULTIPLE_EXPOSURES_ENOUGH_DATA_THRESHOLD,
} from "shared/constants";
import { getMultipleExposureHealthData } from "shared/health";
import { ExperimentInterface, ExperimentType } from "shared/validators";
import { Trans } from "@lingui/react/macro";
import useOrgSettings from "@/hooks/useOrgSettings";
import Callout from "@/ui/Callout";

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});
const numberFormatter = new Intl.NumberFormat();

export default function MultipleExposureWarning({
  multipleExposures,
  totalUsers,
  experiment,
  experimentType,
  isClusterExperiment = false,
  error,
}: {
  multipleExposures: number;
  totalUsers: number;
  experiment?: Pick<ExperimentInterface, "type" | "disableStickyBucketing">;
  experimentType?: ExperimentType;
  isClusterExperiment?: boolean;
  error?: string;
}) {
  const settings = useOrgSettings();

  if (error) {
    return (
      <Callout status="error">
        {isClusterExperiment ? (
          <Trans>
            <strong>Subunit Multiple Exposures Check</strong>. Unable to run
            this check: {error}
          </Trans>
        ) : (
          <Trans>
            <strong>Multiple Exposures Check</strong>. Unable to run this check:{" "}
            {error}
          </Trans>
        )}
      </Callout>
    );
  }

  // For bandits, show warning only if sticky bucketing is enabled
  const isBandit =
    experiment?.type === "multi-armed-bandit" ||
    experimentType === "multi-armed-bandit";
  if (isBandit) {
    // If experiment object is not provided, we can't determine if sticky bucketing is enabled
    if (!experiment) return null;
    const orgStickyBucketing = !!settings?.useStickyBucketing;
    const usingStickyBucketing =
      orgStickyBucketing && !experiment.disableStickyBucketing;
    if (!usingStickyBucketing) return null;
  }

  const multipleExposureHealth = getMultipleExposureHealthData({
    multipleExposuresCount: multipleExposures,
    totalUsersCount: totalUsers,
    minCountThreshold: DEFAULT_MULTIPLE_EXPOSURES_ENOUGH_DATA_THRESHOLD,
    minPercentThreshold:
      settings?.multipleExposureMinPercent ??
      DEFAULT_MULTIPLE_EXPOSURES_THRESHOLD,
  });

  if (multipleExposureHealth.status !== "unhealthy") {
    return null;
  }

  const exposedCount = numberFormatter.format(multipleExposures);
  const exposedPercent = percentFormatter.format(
    multipleExposureHealth.rawDecimal,
  );

  return (
    <Callout status="warning">
      {isClusterExperiment ? (
        <Trans>
          <strong>Subunit Multiple Exposures Warning</strong>. {exposedCount}{" "}
          subunits ({exposedPercent}) saw multiple variations and were
          automatically removed from results. Check for bugs in your
          implementation, event tracking, or data pipeline.
        </Trans>
      ) : (
        <Trans>
          <strong>Multiple Exposures Warning</strong>. {exposedCount} users (
          {exposedPercent}) saw multiple variations and were automatically
          removed from results. Check for bugs in your implementation, event
          tracking, or data pipeline.
        </Trans>
      )}
    </Callout>
  );
}
