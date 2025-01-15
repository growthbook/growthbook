import { getMultipleExposureHealthData } from "shared/health";

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
  const healthData = getMultipleExposureHealthData({
    multipleExposureCount: multipleExposures,
    totalUnitCount: totalUsers,
  });

  if (healthData.status === "healthy") {
    return null;
  }

  return (
    <div className="alert alert-warning">
      <strong>Multiple Exposures Warning</strong>.{" "}
      {numberFormatter.format(multipleExposures)} users (
      {percentFormatter.format(healthData.rawPercent)}) saw multiple variations
      and were automatically removed from results. Check for bugs in your
      implementation, event tracking, or data pipeline.
    </div>
  );
}
