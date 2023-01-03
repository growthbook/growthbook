import useOrgSettings from "@/hooks/useOrgSettings";

const MINIMUM_MULTIPLE_EXPOSURES = 10;

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});
const numberFormatter = new Intl.NumberFormat();

export default function MultipleExposureWarning({
  users,
  multipleExposures,
}: {
  users: number[];
  multipleExposures: number;
}) {
  const settings = useOrgSettings();
  const MIN_PERCENT = settings?.multipleExposureMinPercent ?? 0.01;

  if (multipleExposures < MINIMUM_MULTIPLE_EXPOSURES) return null;
  const totalUsers = users.reduce((sum, n) => sum + n, 0);
  const percent = multipleExposures / (multipleExposures + totalUsers);

  if (percent < MIN_PERCENT) {
    return null;
  }

  return (
    <div className="alert alert-warning">
      <strong>Multiple Exposures Warning</strong>.{" "}
      {numberFormatter.format(multipleExposures)} users (
      {percentFormatter.format(percent)}) saw multiple variations and were
      automatically removed from results. Check for bugs in your implementation,
      event tracking, or data pipeline.
    </div>
  );
}
