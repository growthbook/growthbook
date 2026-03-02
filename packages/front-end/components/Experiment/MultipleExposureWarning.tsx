import {
  DEFAULT_MULTIPLE_EXPOSURES_THRESHOLD,
  DEFAULT_MULTIPLE_EXPOSURES_ENOUGH_DATA_THRESHOLD,
} from "shared/constants";
import { getMultipleExposureHealthData } from "shared/health";
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
}: {
  multipleExposures: number;
  totalUsers: number;
}) {
  const settings = useOrgSettings();

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
