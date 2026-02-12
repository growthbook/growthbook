import {
  DEFAULT_MULTIPLE_EXPOSURES_THRESHOLD,
  DEFAULT_MULTIPLE_EXPOSURES_ENOUGH_DATA_THRESHOLD,
} from "shared/constants";
import { getMultipleExposureHealthData } from "shared/health";
import { ExperimentType } from "shared/types/experiment";
import { ExperimentInterface } from "shared/validators";
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
}: {
  multipleExposures: number;
  totalUsers: number;
  experiment?: Pick<ExperimentInterface, "type" | "disableStickyBucketing">;
  experimentType?: ExperimentType;
}) {
  const settings = useOrgSettings();

  // For bandits, show warning only if sticky bucketing is enabled
  const isBandit =
    experiment?.type === "multi-armed-bandit" ||
    experimentType === "multi-armed-bandit";
  if (isBandit) {
    // Only check sticky bucketing if we have the experiment object
    if (experiment) {
      const orgStickyBucketing = !!settings?.useStickyBucketing;
      const usingStickyBucketing =
        orgStickyBucketing && !experiment.disableStickyBucketing;
      if (!usingStickyBucketing) {
        return null;
      }
    }
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

  return (
    <Callout status="warning">
      <strong>Multiple Exposures Warning</strong>.{" "}
      {numberFormatter.format(multipleExposures)} users (
      {percentFormatter.format(multipleExposureHealth.rawDecimal)}) saw multiple
      variations and were automatically removed from results. Check for bugs in
      your implementation, event tracking, or data pipeline.
    </Callout>
  );
}
